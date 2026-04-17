/**
 * Offscreen document entry point.
 *
 * Hosts a SandboxIframe for REPL execution when the sidepanel is not open.
 * Also provides keepalive pings to keep the service worker alive.
 */

import { SandboxIframe } from "@mariozechner/pi-web-ui";
import type { BridgeReplMessageResponse, BridgeToOffscreenMessage } from "./bridge/internal-messages.js";
import { buildOffscreenRuntimeProviders } from "./bridge/offscreen-runtime-providers.js";

chrome.runtime.onMessage.addListener(
	(
		message: BridgeToOffscreenMessage,
		_sender: chrome.runtime.MessageSender,
		sendResponse: (response: unknown) => void,
	) => {
		if (message.type === "bridge-keepalive-ping") {
			sendResponse({ ok: true });
			return false;
		}

		if (message.type === "bridge-repl-execute") {
			executeRepl(message.params.code, message.params.title, message.windowId)
				.then((result) => {
					sendResponse({ ok: true, result } as BridgeReplMessageResponse);
				})
				.catch((err: Error) => {
					sendResponse({ ok: false, error: err.message } as BridgeReplMessageResponse);
				});
			return true; // async response
		}

		return false;
	},
);

async function executeRepl(
	code: string,
	_title: string,
	windowId?: number,
): Promise<{
	output: string;
	files: Array<{ fileName: string; mimeType: string; size: number; contentBase64: string }>;
}> {
	const sandbox = new SandboxIframe();
	sandbox.sandboxUrlProvider = () => chrome.runtime.getURL("sandbox.html");
	sandbox.style.display = "none";
	document.body.appendChild(sandbox);

	try {
		const sandboxId = `offscreen-repl-${Date.now()}-${Math.random().toString(36).substring(7)}`;
		// Inject proxy providers so browserjs() / navigate() / nativeClick-family
		// calls get forwarded to the background service worker, which has full
		// Chrome API access.
		const providers = buildOffscreenRuntimeProviders(windowId);
		const result = await sandbox.execute(sandboxId, code, providers, []);

		let output = "";
		if (result.console && result.console.length > 0) {
			for (const entry of result.console) {
				output += entry.text + "\n";
			}
		}

		if (!result.success) {
			if (output) output += "\n";
			output += `Error: ${result.error?.message || "Unknown error"}\n${result.error?.stack || ""}`;
			throw new Error(output.trim());
		}

		if (result.returnValue !== undefined) {
			if (output) output += "\n";
			output +=
				typeof result.returnValue === "object"
					? `=> ${JSON.stringify(result.returnValue, null, 2)}`
					: `=> ${result.returnValue}`;
		}

		const files = (result.files || []).map((f) => ({
			fileName: f.fileName || "file",
			mimeType: f.mimeType || "application/octet-stream",
			size: typeof f.content === "string" ? f.content.length : (f.content?.byteLength ?? 0),
			contentBase64: "",
		}));

		return { output: output.trim(), files };
	} finally {
		sandbox.remove();
	}
}

console.log("[Offscreen] Document loaded and ready for REPL execution");
