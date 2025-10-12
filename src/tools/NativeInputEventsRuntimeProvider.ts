import type { SandboxRuntimeProvider } from "@mariozechner/pi-web-ui";
import { NATIVE_INPUT_EVENTS_DESCRIPTION } from "../prompts/tool-prompts.js";

/**
 * Provides native input event functions to browser_javascript using Chrome Debugger API.
 * Dispatches REAL browser events (isTrusted: true) for automation of anti-bot sites.
 */
export class NativeInputEventsRuntimeProvider implements SandboxRuntimeProvider {
	constructor(private tabId: number) {}

	getData(): Record<string, any> {
		return {};
	}

	private getKeyInfo(key: string): { key: string; code: string; keyCode: number } {
		// Key mapping: simple names -> CDP parameters
		// Supports standard key names that LLMs typically know
		const keyMap: Record<string, { key: string; code: string; keyCode: number }> = {
			// Arrow keys
			'ArrowRight': { key: 'ArrowRight', code: 'ArrowRight', keyCode: 39 },
			'ArrowLeft': { key: 'ArrowLeft', code: 'ArrowLeft', keyCode: 37 },
			'ArrowUp': { key: 'ArrowUp', code: 'ArrowUp', keyCode: 38 },
			'ArrowDown': { key: 'ArrowDown', code: 'ArrowDown', keyCode: 40 },

			// Navigation keys
			'Enter': { key: 'Enter', code: 'Enter', keyCode: 13 },
			'Tab': { key: 'Tab', code: 'Tab', keyCode: 9 },
			'Escape': { key: 'Escape', code: 'Escape', keyCode: 27 },
			'Backspace': { key: 'Backspace', code: 'Backspace', keyCode: 8 },
			'Delete': { key: 'Delete', code: 'Delete', keyCode: 46 },
			'Home': { key: 'Home', code: 'Home', keyCode: 36 },
			'End': { key: 'End', code: 'End', keyCode: 35 },
			'PageUp': { key: 'PageUp', code: 'PageUp', keyCode: 33 },
			'PageDown': { key: 'PageDown', code: 'PageDown', keyCode: 34 },

			// Modifier keys
			'Shift': { key: 'Shift', code: 'ShiftLeft', keyCode: 16 },
			'Control': { key: 'Control', code: 'ControlLeft', keyCode: 17 },
			'Alt': { key: 'Alt', code: 'AltLeft', keyCode: 18 },
			'Meta': { key: 'Meta', code: 'MetaLeft', keyCode: 91 },

			// Function keys
			'F1': { key: 'F1', code: 'F1', keyCode: 112 },
			'F2': { key: 'F2', code: 'F2', keyCode: 113 },
			'F3': { key: 'F3', code: 'F3', keyCode: 114 },
			'F4': { key: 'F4', code: 'F4', keyCode: 115 },
			'F5': { key: 'F5', code: 'F5', keyCode: 116 },
			'F6': { key: 'F6', code: 'F6', keyCode: 117 },
			'F7': { key: 'F7', code: 'F7', keyCode: 118 },
			'F8': { key: 'F8', code: 'F8', keyCode: 119 },
			'F9': { key: 'F9', code: 'F9', keyCode: 120 },
			'F10': { key: 'F10', code: 'F10', keyCode: 121 },
			'F11': { key: 'F11', code: 'F11', keyCode: 122 },
			'F12': { key: 'F12', code: 'F12', keyCode: 123 },

			// Special keys
			'Space': { key: ' ', code: 'Space', keyCode: 32 },
			'Insert': { key: 'Insert', code: 'Insert', keyCode: 45 },
		};

		const keyInfo = keyMap[key];
		if (!keyInfo) {
			throw new Error(`Unknown key name: ${key}. Supported keys: ${Object.keys(keyMap).join(', ')}`);
		}

		return keyInfo;
	}

	getRuntime(): (sandboxId: string) => void {
		// This function will be stringified and injected into the user script
		return (_sandboxId: string) => {
			const sendRuntimeMessage = (window as any).sendRuntimeMessage;
			if (typeof sendRuntimeMessage !== "function") {
				throw new Error("sendRuntimeMessage is not available in this context");
			}

			(window as any).nativeClick = async (selector: string): Promise<void> => {
				const response = await sendRuntimeMessage({
					type: "native-input",
					action: "click",
					selector,
				});
				// sendRuntimeMessage throws on error, so if we get here, it succeeded
			};

			(window as any).nativeType = async (selector: string, text: string): Promise<void> => {
				const response = await sendRuntimeMessage({
					type: "native-input",
					action: "type",
					selector,
					text,
				});
			};

			(window as any).nativePress = async (key: string): Promise<void> => {
				const response = await sendRuntimeMessage({
					type: "native-input",
					action: "press",
					key,
				});
			};

			(window as any).nativeKeyDown = async (key: string): Promise<void> => {
				const response = await sendRuntimeMessage({
					type: "native-input",
					action: "keyDown",
					key,
				});
			};

			(window as any).nativeKeyUp = async (key: string): Promise<void> => {
				const response = await sendRuntimeMessage({
					type: "native-input",
					action: "keyUp",
					key,
				});
			};
		};
	}

	async handleMessage(message: any, respond: (response: any) => void): Promise<void> {
		if (message.type !== "native-input") {
			return;
		}

		console.log("[NativeInput] Received event:", message.action, message);


		try {
			// Attach debugger to tab
			await new Promise<void>((resolve, reject) => {
				chrome.debugger.attach({ tabId: this.tabId }, "1.3", () => {
					if (chrome.runtime.lastError) {
						// Check if already attached
						if (chrome.runtime.lastError.message?.includes("already attached")) {
							console.log("[NativeInput] Debugger already attached (OK)");
							resolve(); // Already attached is fine
						} else {
							console.error("[NativeInput] Debugger attach failed:", chrome.runtime.lastError.message);
							reject(new Error(chrome.runtime.lastError.message));
						}
					} else {
						console.log("[NativeInput] Debugger attached successfully");
						resolve();
					}
				});
			});

			if (message.action === "click") {
				console.log("[NativeInput] Finding element:", message.selector);

				// Find element and get its center coordinates
				const result = await chrome.debugger.sendCommand(
					{ tabId: this.tabId },
					"Runtime.evaluate",
					{
						expression: `(() => {
							const el = document.querySelector(${JSON.stringify(message.selector)});
							if (!el) throw new Error('Selector not found: ${message.selector}');
							const rect = el.getBoundingClientRect();
							return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
						})()`,
						returnByValue: true,
					},
				) as any;

				console.log("[NativeInput] Element eval result:", result);

				if (result?.exceptionDetails) {
					console.error("[NativeInput] Element not found:", result.exceptionDetails);
					throw new Error(result.exceptionDetails.exception.description || "Element not found");
				}

				const { x, y } = result.result.value;
				console.log("[NativeInput] Clicking at coordinates:", { x, y });

				// Dispatch trusted mouse events
				const pressResult = await chrome.debugger.sendCommand({ tabId: this.tabId }, "Input.dispatchMouseEvent", {
					type: "mousePressed",
					x,
					y,
					button: "left",
					clickCount: 1,
				});
				console.log("[NativeInput] Mouse pressed result:", pressResult);

				const releaseResult = await chrome.debugger.sendCommand({ tabId: this.tabId }, "Input.dispatchMouseEvent", {
					type: "mouseReleased",
					x,
					y,
					button: "left",
					clickCount: 1,
				});
				console.log("[NativeInput] Mouse released result:", releaseResult);

				console.log("[NativeInput] Click completed successfully");
				respond({ success: true });
			} else if (message.action === "type") {
				console.log("[NativeInput] Typing text:", message.text, "into:", message.selector);

				// Focus element first
				const focusResult = await chrome.debugger.sendCommand(
					{ tabId: this.tabId },
					"Runtime.evaluate",
					{
						expression: `(() => {
							const el = document.querySelector(${JSON.stringify(message.selector)});
							if (!el) throw new Error('Selector not found: ${message.selector}');
							el.focus();
							return true;
						})()`,
						returnByValue: true,
					},
				) as any;

				console.log("[NativeInput] Focus result:", focusResult);

				if (focusResult?.exceptionDetails) {
					console.error("[NativeInput] Element not found for typing:", focusResult.exceptionDetails);
					throw new Error(focusResult.exceptionDetails.exception.description || "Element not found");
				}

				// Type each character
				for (const char of message.text) {
					await chrome.debugger.sendCommand({ tabId: this.tabId }, "Input.dispatchKeyEvent", {
						type: "keyDown",
						text: char,
					});

					await chrome.debugger.sendCommand({ tabId: this.tabId }, "Input.dispatchKeyEvent", {
						type: "keyUp",
						text: char,
					});
				}

				console.log("[NativeInput] Typing completed successfully");
				respond({ success: true });
			} else if (message.action === "press") {
				console.log("[NativeInput] Pressing key:", message.key);

				const keyInfo = this.getKeyInfo(message.key);

				// Press single key with proper CDP parameters
				const keyDownResult = await chrome.debugger.sendCommand({ tabId: this.tabId }, "Input.dispatchKeyEvent", {
					type: "keyDown",
					key: keyInfo.key,
					code: keyInfo.code,
					windowsVirtualKeyCode: keyInfo.keyCode,
					nativeVirtualKeyCode: keyInfo.keyCode,
				});
				console.log("[NativeInput] Key down result:", keyDownResult);

				const keyUpResult = await chrome.debugger.sendCommand({ tabId: this.tabId }, "Input.dispatchKeyEvent", {
					type: "keyUp",
					key: keyInfo.key,
					code: keyInfo.code,
					windowsVirtualKeyCode: keyInfo.keyCode,
					nativeVirtualKeyCode: keyInfo.keyCode,
				});
				console.log("[NativeInput] Key up result:", keyUpResult);

				console.log("[NativeInput] Key press completed successfully");
				respond({ success: true });
			} else if (message.action === "keyDown") {
				console.log("[NativeInput] Key down:", message.key);

				const keyInfo = this.getKeyInfo(message.key);

				const keyDownResult = await chrome.debugger.sendCommand({ tabId: this.tabId }, "Input.dispatchKeyEvent", {
					type: "keyDown",
					key: keyInfo.key,
					code: keyInfo.code,
					windowsVirtualKeyCode: keyInfo.keyCode,
					nativeVirtualKeyCode: keyInfo.keyCode,
				});
				console.log("[NativeInput] Key down result:", keyDownResult);

				console.log("[NativeInput] Key down completed successfully");
				respond({ success: true });
			} else if (message.action === "keyUp") {
				console.log("[NativeInput] Key up:", message.key);

				const keyInfo = this.getKeyInfo(message.key);

				const keyUpResult = await chrome.debugger.sendCommand({ tabId: this.tabId }, "Input.dispatchKeyEvent", {
					type: "keyUp",
					key: keyInfo.key,
					code: keyInfo.code,
					windowsVirtualKeyCode: keyInfo.keyCode,
					nativeVirtualKeyCode: keyInfo.keyCode,
				});
				console.log("[NativeInput] Key up result:", keyUpResult);

				console.log("[NativeInput] Key up completed successfully");
				respond({ success: true });
			} else {
				console.error("[NativeInput] Unknown action:", message.action);
				respond({ success: false, error: `Unknown action: ${message.action}` });
			}
		} catch (error: any) {
			console.error("[NativeInput] Error during operation:", error);
			respond({ success: false, error: error.message || String(error) });
		}
	}

	getDescription(): string {
		return NATIVE_INPUT_EVENTS_DESCRIPTION;
	}
}
