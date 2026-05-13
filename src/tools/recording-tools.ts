import {
	BridgeDefaults,
	type RecordFrameEventData,
	type RecordOutcome,
	type RecordStartParams,
	type RecordStartResult,
	type RecordStatusParams,
	type RecordStatusResult,
	type RecordStopParams,
	type RecordStopResult,
} from "../bridge/protocol.js";
import type { BridgeTelemetry, BridgeTelemetrySpan, TraceContext } from "../bridge/telemetry.js";
import { resolveTabTarget } from "./helpers/browser-target.js";
import type { DebuggerManager } from "./helpers/debugger-manager.js";

interface ScreencastFrameMetadata {
	timestamp?: number;
	deviceWidth?: number;
	deviceHeight?: number;
	pageScaleFactor?: number;
	offsetTop?: number;
	scrollOffsetX?: number;
	scrollOffsetY?: number;
}

interface ScreencastFrameParams {
	data?: unknown;
	sessionId?: unknown;
	metadata?: ScreencastFrameMetadata;
}

interface RecordingState {
	recordingId: string;
	tabId: number;
	startedAtMs: number;
	startedAt: string;
	mimeType: string;
	videoBitsPerSecond?: number;
	maxDurationMs: number;
	owner: string;
	format: "jpeg";
	fps: number;
	quality: number;
	maxWidth?: number;
	maxHeight?: number;
	everyNthFrame: number;
	sourceBytes: number;
	frameCount: number;
	lastError?: string;
	outcome?: RecordOutcome;
	stopping: boolean;
	screencastActive: boolean;
	removeListener?: () => void;
	removeDetachListener?: () => void;
	maxDurationTimer?: ReturnType<typeof setTimeout>;
	forceStopTimer?: ReturnType<typeof setTimeout>;
	resolveCompletion: (result: RecordStopResult) => void;
	completion: Promise<RecordStopResult>;
	span?: BridgeTelemetrySpan;
}

export interface RecordingToolsOptions {
	windowId: number;
	debuggerManager: DebuggerManager;
	emitRecordFrame: (data: RecordFrameEventData) => void;
	telemetry?: BridgeTelemetry;
}

const DISALLOWED_SCHEMES = ["chrome:", "chrome-extension:", "devtools:", "view-source:", "about:"];

function createRecordingId(tabId: number): string {
	return `rec-${tabId}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function base64ByteLength(value: string): number {
	if (!value) return 0;
	const padding = value.endsWith("==") ? 2 : value.endsWith("=") ? 1 : 0;
	return Math.max(0, Math.floor((value.length * 3) / 4) - padding);
}

function codecFromMimeType(mimeType: string): string | undefined {
	const match = /codecs=([^;]+)/iu.exec(mimeType);
	return match?.[1]?.replace(/["']/g, "").trim();
}

function assertDurationAllowed(maxDurationMs: number): void {
	if (!Number.isFinite(maxDurationMs) || maxDurationMs <= 0) {
		throw new Error("Recording max duration must be greater than 0ms");
	}
	if (maxDurationMs > BridgeDefaults.RECORD_HARD_MAX_DURATION_MS) {
		throw new Error(`Recording max duration exceeds hard limit of ${BridgeDefaults.RECORD_HARD_MAX_DURATION_MS}ms`);
	}
}

function normalizeInteger(value: number | undefined, fallback: number): number {
	return Number.isFinite(value) ? Math.trunc(value as number) : fallback;
}

export function assertRecordableTabUrl(url?: string): void {
	let protocol = "";
	try {
		protocol = url ? new URL(url).protocol : "";
	} catch {
		protocol = "";
	}
	if (DISALLOWED_SCHEMES.includes(protocol)) {
		throw new Error(`Cannot record ${url}. Chrome debugger screencast does not support internal or extension pages.`);
	}
}

export class RecordingTools {
	private readonly recordingsByTabId = new Map<number, RecordingState>();
	private readonly recordingsById = new Map<string, RecordingState>();
	private readonly windowId: number;
	private readonly debuggerManager: DebuggerManager;
	private readonly emitRecordFrame: (data: RecordFrameEventData) => void;
	private readonly telemetry?: BridgeTelemetry;

	constructor(options: RecordingToolsOptions) {
		this.windowId = options.windowId;
		this.debuggerManager = options.debuggerManager;
		this.emitRecordFrame = options.emitRecordFrame;
		this.telemetry = options.telemetry;
	}

	async start(
		params: RecordStartParams,
		signal?: AbortSignal,
		traceContext?: TraceContext,
	): Promise<RecordStartResult> {
		const maxDurationMs = params.maxDurationMs ?? BridgeDefaults.RECORD_DEFAULT_MAX_DURATION_MS;
		assertDurationAllowed(maxDurationMs);

		const resolved = await resolveTabTarget({ windowId: params.windowId ?? this.windowId, tabId: params.tabId });
		const tab = resolved.tab;
		const tabId = resolved.tabId;
		if (this.recordingsByTabId.has(tabId)) {
			throw new Error(`Recording is already active for tab ${tabId}`);
		}
		assertRecordableTabUrl(tab.url);
		if (signal?.aborted) {
			throw new Error("Recording start aborted");
		}

		const recordingId = createRecordingId(tabId);
		const fps = normalizeInteger(params.fps, BridgeDefaults.RECORD_DEFAULT_FPS);
		const quality = normalizeInteger(params.quality, BridgeDefaults.RECORD_DEFAULT_JPEG_QUALITY);
		const maxWidth = normalizeInteger(params.maxWidth, BridgeDefaults.RECORD_DEFAULT_MAX_WIDTH);
		const maxHeight = typeof params.maxHeight === "number" ? normalizeInteger(params.maxHeight, 0) : undefined;
		const everyNthFrame = normalizeInteger(params.everyNthFrame, 1);
		const owner = `record-screencast:${tabId}`;
		let resolveCompletion!: (result: RecordStopResult) => void;
		const completion = new Promise<RecordStopResult>((resolve) => {
			resolveCompletion = resolve;
		});
		const state: RecordingState = {
			recordingId,
			tabId,
			startedAtMs: Date.now(),
			startedAt: "",
			mimeType: params.mimeType ?? "video/webm",
			videoBitsPerSecond: params.videoBitsPerSecond,
			maxDurationMs,
			owner,
			format: "jpeg",
			fps,
			quality,
			maxWidth,
			maxHeight,
			everyNthFrame,
			sourceBytes: 0,
			frameCount: 0,
			stopping: false,
			screencastActive: false,
			resolveCompletion,
			completion,
			span: this.telemetry?.startSpan("record.session", {
				parent: traceContext,
				attributes: {
					"bridge.method": "record_start",
					"bridge.window_id": this.windowId,
					"record.recording_id": recordingId,
					"record.tab_id": tabId,
					"record.mime_type": params.mimeType,
					"record.codec": params.mimeType ? codecFromMimeType(params.mimeType) : undefined,
					"record.video_bits_per_second": params.videoBitsPerSecond,
					"record.fps": fps,
					"record.quality": quality,
					"record.max_width": maxWidth,
					"record.max_height": maxHeight,
				},
			}),
		};
		state.startedAt = new Date(state.startedAtMs).toISOString();
		this.recordingsByTabId.set(tabId, state);
		this.recordingsById.set(recordingId, state);

		try {
			await this.debuggerManager.acquireWithTrace(tabId, owner, {
				parent: state.span?.context,
				operationName: "record.debugger.acquire",
				attributes: { "record.recording_id": recordingId },
			});
			await this.debuggerManager.ensureDomainWithTrace(tabId, "Page", {
				parent: state.span?.context,
				operationName: "record.debugger.page_enable",
				attributes: { "record.recording_id": recordingId },
			});
			state.removeListener = this.debuggerManager.addEventListener(tabId, (method, frameParams) => {
				void this.handleDebuggerEvent(state, method, frameParams).catch((error) => this.forceStop(state, error));
			});
			state.removeDetachListener = this.debuggerManager.addDetachListener(tabId, ({ reason }) => {
				state.lastError = `Debugger detached: ${String(reason)}`;
				state.span?.recordError(new Error(state.lastError));
				this.forceStop(state, state.lastError, { releaseDebugger: false });
			});
			const startParams: Record<string, unknown> = {
				format: state.format,
				quality: state.quality,
				maxWidth: state.maxWidth,
				everyNthFrame: state.everyNthFrame,
			};
			if (typeof state.maxHeight === "number" && state.maxHeight > 0) startParams.maxHeight = state.maxHeight;
			await this.debuggerManager.sendCommandWithTrace(tabId, "Page.startScreencast", startParams, {
				parent: state.span?.context,
				operationName: "record.screencast.start",
				attributes: { "record.recording_id": recordingId },
			});
			state.screencastActive = true;
			state.maxDurationTimer = setTimeout(() => {
				void this.stopRecording(state, "stopped_max_duration").catch((error) => this.forceStop(state, error));
			}, maxDurationMs);
		} catch (error) {
			this.cleanupState(state, { releaseDebugger: true });
			state.span?.recordError(error);
			state.span?.end("error");
			throw error;
		}

		return {
			ok: true,
			recordingId,
			tabId,
			startedAt: state.startedAt,
			mimeType: state.mimeType,
			videoBitsPerSecond: state.videoBitsPerSecond,
			maxDurationMs,
		};
	}

	async stop(params: RecordStopParams, signal?: AbortSignal, traceContext?: TraceContext): Promise<RecordStopResult> {
		if (signal?.aborted) {
			throw new Error("Recording stop aborted");
		}
		const tabId = await this.resolveRecordingTabId(params.tabId);
		if (typeof tabId !== "number") {
			throw new Error("No active recording");
		}
		const state = this.recordingsByTabId.get(tabId);
		if (!state) {
			throw new Error(`No active recording for tab ${tabId}`);
		}
		const span = this.telemetry?.startSpan("record.stop", {
			parent: traceContext,
			attributes: {
				"bridge.method": "record_stop",
				"bridge.window_id": this.windowId,
				"record.recording_id": state.recordingId,
				"record.tab_id": state.tabId,
			},
		});
		try {
			const result = await this.stopRecording(state, "stopped_user");
			span?.setAttributes({
				"record.duration_ms": result.durationMs,
				"record.mime_type": result.mimeType,
				"record.codec": codecFromMimeType(result.mimeType),
				"record.size_bytes": result.sizeBytes,
				"record.source_bytes": result.sourceBytes,
				"record.frame_count": result.frameCount,
				"record.outcome": result.outcome,
			});
			span?.end("ok");
			return result;
		} catch (error) {
			span?.recordError(error);
			span?.end("error");
			throw error;
		}
	}

	async status(params: RecordStatusParams, traceContext?: TraceContext): Promise<RecordStatusResult> {
		const span = this.telemetry?.startSpan("record.status", {
			parent: traceContext,
			attributes: {
				"bridge.method": "record_status",
				"bridge.window_id": this.windowId,
			},
		});
		try {
			const tabId = await this.resolveRecordingTabId(params.tabId, true);
			const state = typeof tabId === "number" ? this.recordingsByTabId.get(tabId) : undefined;
			if (!state) {
				span?.end("ok");
				return { active: false };
			}
			const result: RecordStatusResult = {
				active: true,
				recordingId: state.recordingId,
				tabId: state.tabId,
				startedAt: state.startedAt,
				mimeType: state.mimeType,
				durationMs: Date.now() - state.startedAtMs,
				sizeBytes: state.sourceBytes,
				sourceBytes: state.sourceBytes,
				chunkCount: state.frameCount,
				frameCount: state.frameCount,
				fps: state.fps,
				lastError: state.lastError,
			};
			span?.setAttributes({
				"record.recording_id": state.recordingId,
				"record.tab_id": state.tabId,
				"record.duration_ms": result.durationMs,
				"record.mime_type": state.mimeType,
				"record.source_bytes": state.sourceBytes,
				"record.frame_count": state.frameCount,
			});
			span?.end("ok");
			return result;
		} catch (error) {
			span?.recordError(error);
			span?.end("error");
			throw error;
		}
	}

	hasRecording(recordingId: string): boolean {
		return this.recordingsById.has(recordingId);
	}

	hasRecordingForTab(tabId: number): boolean {
		return this.recordingsByTabId.has(tabId);
	}

	getActiveTabIds(): number[] {
		return Array.from(this.recordingsByTabId.keys());
	}

	handleTabClosed(tabId: number): void {
		const state = this.recordingsByTabId.get(tabId);
		if (!state) return;
		void this.stopRecording(state, "stopped_tab_closed").catch((error) => this.forceStop(state, error));
	}

	private async resolveRecordingTabId(tabId?: number, allowMissing = false): Promise<number | undefined> {
		if (typeof tabId === "number") return tabId;
		if (this.recordingsByTabId.size === 1) {
			return this.recordingsByTabId.keys().next().value as number;
		}
		try {
			return (await resolveTabTarget({ windowId: this.windowId })).tabId;
		} catch (error) {
			if (allowMissing) return undefined;
			throw error;
		}
	}

	private async handleDebuggerEvent(
		state: RecordingState,
		method: string,
		params: Record<string, unknown> | undefined,
	): Promise<void> {
		if (method !== "Page.screencastFrame") return;
		const frame = (params ?? {}) as ScreencastFrameParams;
		if (typeof frame.sessionId === "number") {
			await this.debuggerManager.sendCommand(state.tabId, "Page.screencastFrameAck", { sessionId: frame.sessionId });
		}
		if (typeof frame.data !== "string" || typeof frame.sessionId !== "number") {
			return;
		}
		const bytes = base64ByteLength(frame.data);
		const seq = state.frameCount;
		state.sourceBytes += bytes;
		state.frameCount += 1;
		const capturedAtMs = Date.now();
		this.telemetry
			?.startSpan("record.frame", {
				parent: state.span?.context,
				attributes: {
					"record.recording_id": state.recordingId,
					"record.tab_id": state.tabId,
					"record.seq": seq,
					"record.frame_bytes": bytes,
				},
			})
			.end("ok");
		this.emitRecordFrame({
			recordingId: state.recordingId,
			tabId: state.tabId,
			seq,
			format: state.format,
			dataBase64: frame.data,
			capturedAtMs,
			metadata: frame.metadata,
		});
		if (state.sourceBytes >= BridgeDefaults.RECORD_HARD_MAX_BYTES && !state.stopping) {
			await this.stopRecording(state, "stopped_max_bytes");
		}
	}

	private async stopRecording(state: RecordingState, outcome: RecordOutcome): Promise<RecordStopResult> {
		if (!state.stopping) {
			state.stopping = true;
			state.outcome = outcome;
			clearTimeout(state.maxDurationTimer);
			try {
				if (state.screencastActive) {
					await this.debuggerManager.sendCommandWithTrace(state.tabId, "Page.stopScreencast", undefined, {
						parent: state.span?.context,
						operationName: "record.screencast.stop",
						attributes: { "record.recording_id": state.recordingId, "record.outcome": outcome },
					});
					state.screencastActive = false;
				}
			} catch (error) {
				state.lastError = error instanceof Error ? error.message : String(error);
				state.span?.recordError(error);
			}
			state.removeListener?.();
			state.removeListener = undefined;
			state.removeDetachListener?.();
			state.removeDetachListener = undefined;
			await this.debuggerManager.release(state.tabId, state.owner);
			this.finishRecording(state, outcome, Date.now(), { releaseDebugger: false });
		}
		return state.completion;
	}

	private forceStop(
		state: RecordingState,
		error?: unknown,
		options: { releaseDebugger?: boolean } = { releaseDebugger: true },
	): void {
		if (error) {
			state.lastError = error instanceof Error ? error.message : String(error);
			state.span?.recordError(error);
		}
		this.finishRecording(state, state.outcome ?? "stopped_error", Date.now(), options);
	}

	private cleanupState(state: RecordingState, options: { releaseDebugger?: boolean }): void {
		clearTimeout(state.maxDurationTimer);
		clearTimeout(state.forceStopTimer);
		state.removeListener?.();
		state.removeListener = undefined;
		state.removeDetachListener?.();
		state.removeDetachListener = undefined;
		this.recordingsByTabId.delete(state.tabId);
		this.recordingsById.delete(state.recordingId);
		if (options.releaseDebugger !== false) {
			void this.debuggerManager.release(state.tabId, state.owner).catch((error) => {
				state.lastError = error instanceof Error ? error.message : String(error);
			});
		}
	}

	private finishRecording(
		state: RecordingState,
		outcome: RecordOutcome,
		endedAtMs: number,
		options: { releaseDebugger?: boolean } = { releaseDebugger: true },
	): void {
		if (!this.recordingsById.has(state.recordingId)) return;
		this.cleanupState(state, options);
		const result: RecordStopResult = {
			ok: true,
			recordingId: state.recordingId,
			tabId: state.tabId,
			startedAt: state.startedAt,
			endedAt: new Date(endedAtMs).toISOString(),
			durationMs: endedAtMs - state.startedAtMs,
			mimeType: state.mimeType,
			sizeBytes: state.sourceBytes,
			sourceBytes: state.sourceBytes,
			chunkCount: state.frameCount,
			frameCount: state.frameCount,
			outcome,
		};
		state.span?.setAttributes({
			"record.duration_ms": result.durationMs,
			"record.mime_type": state.mimeType,
			"record.codec": codecFromMimeType(state.mimeType),
			"record.video_bits_per_second": state.videoBitsPerSecond,
			"record.source_bytes": state.sourceBytes,
			"record.frame_count": state.frameCount,
			"record.outcome": outcome,
		});
		state.span?.end(outcome === "stopped_error" ? "error" : "ok");
		this.emitRecordFrame({
			recordingId: state.recordingId,
			tabId: state.tabId,
			seq: state.frameCount,
			format: state.format,
			dataBase64: "",
			capturedAtMs: endedAtMs,
			final: true,
			summary: result,
		});
		state.resolveCompletion(result);
		void this.telemetry?.flush();
	}
}
