/**
 * Bridge-mode command executor.
 *
 * Instantiates the same browser tools used by the sidepanel agent and
 * exposes bridge-friendly methods that accept an AbortSignal. This keeps
 * the bridge and agent tooling backed by the same underlying code.
 */

import { DebuggerTool } from "../tools/debugger.js";
import { ExtractImageTool } from "../tools/extract-image.js";
import { AskUserWhichElementTool } from "../tools/index.js";
import { NativeInputEventsRuntimeProvider } from "../tools/NativeInputEventsRuntimeProvider.js";
import { NavigateTool } from "../tools/navigate.js";
import { createReplTool } from "../tools/repl/repl.js";
import { BrowserJsRuntimeProvider, NavigateRuntimeProvider } from "../tools/repl/runtime-providers.js";
import type {
	BridgeMethod,
	BridgeReplResult,
	BridgeScreenshotResult,
	BridgeStatusResult,
	EvalParams,
	NavigateParams,
	ReplParams,
	ScreenshotParams,
	SelectElementParams,
	SessionHistoryParams,
	SessionHistoryResult,
	SessionInjectParams,
	SessionInjectResult,
} from "./protocol.js";
import { ErrorCodes, getBridgeCapabilities } from "./protocol.js";
import { buildSessionHistoryResult, type SessionBridgeAdapter } from "./session-bridge.js";

export interface BrowserCommandExecutorOptions {
	windowId: number;
	sessionId?: string;
	debuggerEnabled: boolean;
	sessionBridge?: SessionBridgeAdapter;
}

export class BrowserCommandExecutor {
	private readonly navigateTool: NavigateTool;
	private readonly selectElementTool: AskUserWhichElementTool;
	private readonly replTool: ReturnType<typeof createReplTool>;
	private readonly extractImageTool: ExtractImageTool;
	private readonly debuggerTool: DebuggerTool;
	private readonly windowId: number;
	private readonly sessionId?: string;
	private readonly debuggerEnabled: boolean;
	private readonly sessionBridge?: SessionBridgeAdapter;

	constructor(options: BrowserCommandExecutorOptions) {
		this.windowId = options.windowId;
		this.sessionId = options.sessionId;
		this.debuggerEnabled = options.debuggerEnabled;
		this.sessionBridge = options.sessionBridge;

		this.navigateTool = new NavigateTool();
		this.selectElementTool = new AskUserWhichElementTool();

		this.replTool = createReplTool();
		this.replTool.sandboxUrlProvider = () => chrome.runtime.getURL("sandbox.html");
		this.replTool.runtimeProvidersFactory = () => {
			// Bridge mode: no ChatPanel artifact providers, only browser orchestration
			const pageProviders = [new NativeInputEventsRuntimeProvider()];
			return [
				...pageProviders,
				new BrowserJsRuntimeProvider(pageProviders),
				new NavigateRuntimeProvider(this.navigateTool),
			];
		};

		this.extractImageTool = new ExtractImageTool();
		this.extractImageTool.windowId = options.windowId;

		this.debuggerTool = new DebuggerTool();
	}

	/** Dispatch a bridge command by method name. */
	async dispatch(
		method: BridgeMethod,
		params: Record<string, unknown> | undefined,
		signal?: AbortSignal,
	): Promise<unknown> {
		switch (method) {
			case "status":
				return this.status();
			case "navigate":
				return this.navigate((params ?? {}) as NavigateParams, signal);
			case "repl":
				return this.repl(params as unknown as ReplParams, signal);
			case "screenshot":
				return this.screenshot((params ?? {}) as ScreenshotParams, signal);
			case "eval":
				return this.evalCode(params as unknown as EvalParams, signal);
			case "select_element":
				return this.selectElement((params ?? {}) as SelectElementParams, signal);
			case "session_history":
				return this.sessionHistory((params ?? {}) as SessionHistoryParams);
			case "session_inject":
				return this.sessionInject(params as unknown as SessionInjectParams, signal);
			default:
				throw new Error("Unknown method: " + method);
		}
	}

	async status(): Promise<BridgeStatusResult> {
		const [tab] = await chrome.tabs.query({ active: true, windowId: this.windowId });
		return {
			ok: true,
			ready: true,
			windowId: this.windowId,
			sessionId: this.sessionId,
			capabilities: getBridgeCapabilities(this.debuggerEnabled),
			activeTab: {
				url: tab?.url,
				title: tab?.title,
				tabId: tab?.id,
			},
		};
	}

	async navigate(params: NavigateParams, signal?: AbortSignal): Promise<unknown> {
		const result = await this.navigateTool.execute("bridge", params, signal);
		return result.details;
	}

	async repl(params: ReplParams, signal?: AbortSignal): Promise<BridgeReplResult> {
		const result = await this.replTool.execute("bridge", { title: params.title, code: params.code }, signal);
		const output = result.content.find((item) => item.type === "text")?.text || "";
		return {
			output,
			files: result.details?.files || [],
		};
	}

	async screenshot(params: ScreenshotParams, signal?: AbortSignal): Promise<BridgeScreenshotResult> {
		const result = await this.extractImageTool.execute(
			"bridge",
			{ mode: "screenshot", maxWidth: params.maxWidth ?? 1024 },
			signal,
		);
		const image = result.content.find((item) => item.type === "image") as
			| { type: "image"; data: string; mimeType: string }
			| undefined;
		if (!image?.data || !image.mimeType) {
			throw new Error("Screenshot tool returned no image data");
		}
		return {
			mimeType: image.mimeType as BridgeScreenshotResult["mimeType"],
			dataUrl: `data:${image.mimeType};base64,${image.data}`,
		};
	}

	async evalCode(params: EvalParams, signal?: AbortSignal): Promise<unknown> {
		if (!this.debuggerEnabled) {
			const error = new Error("Eval bridge command is disabled unless debugger mode is enabled");
			(error as Error & { code?: number }).code = ErrorCodes.CAPABILITY_DISABLED;
			throw error;
		}
		const result = await this.debuggerTool.execute("bridge", { action: "eval", code: params.code }, signal);
		return result.details;
	}

	async selectElement(params: SelectElementParams, signal?: AbortSignal): Promise<unknown> {
		const result = await this.selectElementTool.execute("bridge", { message: params.message ?? "" }, signal);
		return result.details;
	}

	async sessionHistory(params: SessionHistoryParams): Promise<SessionHistoryResult> {
		if (!this.sessionBridge) {
			throw new Error("Session bridge is not available");
		}
		return buildSessionHistoryResult(this.sessionBridge.getSnapshot(), params);
	}

	async sessionInject(params: SessionInjectParams, signal?: AbortSignal): Promise<SessionInjectResult> {
		if (!this.sessionBridge) {
			throw new Error("Session bridge is not available");
		}
		if (signal?.aborted) {
			const error = new Error("Session injection aborted");
			(error as Error & { code?: number }).code = ErrorCodes.ABORTED;
			throw error;
		}
		return this.sessionBridge.appendInjectedMessage(params);
	}
}
