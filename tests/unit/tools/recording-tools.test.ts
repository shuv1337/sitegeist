import type { RecordFrameEventData } from "../../../src/bridge/protocol.js";
import type { DebuggerManager } from "../../../src/tools/helpers/debugger-manager.js";

const tabsGet = vi.fn();
const tabsQuery = vi.fn();

declare global {
	var chrome: {
		tabs: { get: typeof tabsGet; query: typeof tabsQuery };
	};
}

globalThis.chrome = {
	tabs: {
		get: tabsGet,
		query: tabsQuery,
	},
};

const { RecordingTools, assertRecordableTabUrl } = await import("../../../src/tools/recording-tools.js");

function activeTab(url = "https://example.com"): chrome.tabs.Tab {
	return { id: 9, windowId: 7, active: true, url, title: "Example" };
}

class MockDebuggerManager {
	acquireWithTrace = vi.fn(async () => undefined);
	release = vi.fn(async () => undefined);
	ensureDomainWithTrace = vi.fn(async () => undefined);
	sendCommand = vi.fn(async () => undefined);
	sendCommandWithTrace = vi.fn(async () => undefined);
	eventListener?: (method: string, params: Record<string, unknown> | undefined) => void;
	detachListener?: (event: { tabId: number; reason: string }) => void;

	addEventListener = vi.fn((_tabId: number, listener: (method: string, params: Record<string, unknown> | undefined) => void) => {
		this.eventListener = listener;
		return vi.fn();
	});

	addDetachListener = vi.fn((_tabId: number, listener: (event: { tabId: number; reason: string }) => void) => {
		this.detachListener = listener;
		return vi.fn();
	});
}

function createTools() {
	const frames: RecordFrameEventData[] = [];
	const debuggerManager = new MockDebuggerManager();
	const tools = new RecordingTools({
		windowId: 7,
		debuggerManager: debuggerManager as unknown as DebuggerManager,
		emitRecordFrame: (data) => frames.push(data),
	});
	return { tools, debuggerManager, frames };
}

describe("RecordingTools", () => {
	beforeEach(() => {
		vi.useRealTimers();
		vi.clearAllMocks();
		const tab = activeTab();
		tabsGet.mockResolvedValue(tab);
		tabsQuery.mockResolvedValue([tab]);
	});

	it("starts Page.startScreencast with expected defaults", async () => {
		const { tools, debuggerManager } = createTools();
		await expect(tools.start({ tabId: 9 })).resolves.toMatchObject({ recordingId: expect.any(String), tabId: 9 });
		expect(debuggerManager.acquireWithTrace).toHaveBeenCalledWith(9, "record-screencast:9", expect.any(Object));
		expect(debuggerManager.ensureDomainWithTrace).toHaveBeenCalledWith(9, "Page", expect.any(Object));
		expect(debuggerManager.sendCommandWithTrace).toHaveBeenCalledWith(
			9,
			"Page.startScreencast",
			expect.objectContaining({ format: "jpeg", quality: 70, maxWidth: 1280, everyNthFrame: 1 }),
			expect.any(Object),
		);
	});

	it("rejects a second active recording on the same tab", async () => {
		const { tools } = createTools();
		await expect(tools.start({ tabId: 9 })).resolves.toMatchObject({ recordingId: expect.any(String), tabId: 9 });
		await expect(tools.start({ tabId: 9 })).rejects.toThrow("Recording is already active for tab 9");
	});

	it("rejects stop with no active recording", async () => {
		const { tools } = createTools();
		await expect(tools.stop({ tabId: 9 })).rejects.toThrow("No active recording for tab 9");
	});

	it("record_status exposes frame stats but never frame bytes", async () => {
		const { tools, debuggerManager } = createTools();
		await tools.start({ tabId: 9 });
		debuggerManager.eventListener?.("Page.screencastFrame", {
			data: "YWJj",
			sessionId: 1,
		});
		await Promise.resolve();
		const status = await tools.status({ tabId: 9 });
		expect(status).toMatchObject({ active: true, sizeBytes: 3, sourceBytes: 3, frameCount: 1, durationMs: expect.any(Number) });
		expect(status).not.toHaveProperty("dataBase64");
	});

	it("emits record_frame and acks screencast frames", async () => {
		const { tools, debuggerManager, frames } = createTools();
		const started = await tools.start({ tabId: 9 });
		debuggerManager.eventListener?.("Page.screencastFrame", {
			data: "YWJj",
			sessionId: 7,
			metadata: { deviceWidth: 800 },
		});
		await Promise.resolve();
		expect(debuggerManager.sendCommand).toHaveBeenCalledWith(9, "Page.screencastFrameAck", { sessionId: 7 });
		expect(frames[0]).toMatchObject({
			recordingId: started.recordingId,
			tabId: 9,
			seq: 0,
			format: "jpeg",
			dataBase64: "YWJj",
			metadata: { deviceWidth: 800 },
		});
	});

	it("auto-stops with stopped_max_duration", async () => {
		vi.useFakeTimers();
		const { tools, debuggerManager, frames } = createTools();
		await tools.start({ tabId: 9, maxDurationMs: 1 });
		await vi.advanceTimersByTimeAsync(1);
		expect(debuggerManager.sendCommandWithTrace).toHaveBeenCalledWith(9, "Page.stopScreencast", undefined, expect.any(Object));
		expect(frames.at(-1)?.summary?.outcome).toBe("stopped_max_duration");
	});

	it("auto-stops with stopped_tab_closed", async () => {
		const { tools, frames } = createTools();
		await tools.start({ tabId: 9 });
		tools.handleTabClosed(9);
		await new Promise((resolve) => setTimeout(resolve, 0));
		expect(frames.at(-1)?.summary?.outcome).toBe("stopped_tab_closed");
	});

	it("auto-stops with stopped_error on debugger detach", async () => {
		const { tools, debuggerManager, frames } = createTools();
		await tools.start({ tabId: 9 });
		debuggerManager.detachListener?.({ tabId: 9, reason: "target_closed" });
		expect(frames.at(-1)?.summary?.outcome).toBe("stopped_error");
	});

	it("rejects disallowed debugger screencast schemes", () => {
		expect(() => assertRecordableTabUrl("chrome://settings")).toThrow("Cannot record chrome://settings");
		expect(() => assertRecordableTabUrl("chrome-extension://abc/page.html")).toThrow("Cannot record");
		expect(() => assertRecordableTabUrl("about:blank")).toThrow("Cannot record about:blank");
	});
});
