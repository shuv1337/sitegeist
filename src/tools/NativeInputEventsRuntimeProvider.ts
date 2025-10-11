import type { SandboxRuntimeProvider } from "@mariozechner/pi-web-ui";

/**
 * Provides native input event functions to browser_javascript using Chrome Debugger API.
 * Dispatches REAL browser events (isTrusted: true) for automation of anti-bot sites.
 */
export class NativeInputEventsRuntimeProvider implements SandboxRuntimeProvider {
	constructor(private tabId: number) {}

	getData(): Record<string, any> {
		return {};
	}

	getRuntime(): (sandboxId: string) => void {
		// This function will be stringified and injected into the user script
		return (sandboxId: string) => {
			const runtimeApi = ((window as any).browser ?? (window as any).chrome)?.runtime;
			if (!runtimeApi?.sendMessage) {
				throw new Error("Extension messaging API is not available in this context");
			}

			const sendMessage = async (payload: any) => {
				return await runtimeApi.sendMessage({ ...payload, sandboxId });
			};

			// Override bridge implementation with stable reference so page scripts can't clobber chrome.runtime
			(window as any).sendRuntimeMessage = sendMessage;

			(window as any).nativeClick = async (selector: string): Promise<void> => {
				const response = await sendMessage({
					type: "native-input",
					action: "click",
					selector,
				});
				// sendRuntimeMessage throws on error, so if we get here, it succeeded
			};

			(window as any).nativeType = async (selector: string, text: string): Promise<void> => {
				const response = await sendMessage({
					type: "native-input",
					action: "type",
					selector,
					text,
				});
			};

			(window as any).nativePress = async (key: string): Promise<void> => {
				const response = await sendMessage({
					type: "native-input",
					action: "press",
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

		const browser = (globalThis as any).chrome;

		try {
			// Attach debugger to tab
			await new Promise<void>((resolve, reject) => {
				browser.debugger.attach({ tabId: this.tabId }, "1.3", () => {
					if (browser.runtime.lastError) {
						// Check if already attached
						if (browser.runtime.lastError.message?.includes("already attached")) {
							console.log("[NativeInput] Debugger already attached (OK)");
							resolve(); // Already attached is fine
						} else {
							console.error("[NativeInput] Debugger attach failed:", browser.runtime.lastError.message);
							reject(new Error(browser.runtime.lastError.message));
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
				const result = await browser.debugger.sendCommand(
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
				);

				console.log("[NativeInput] Element eval result:", result);

				if (result.exceptionDetails) {
					console.error("[NativeInput] Element not found:", result.exceptionDetails);
					throw new Error(result.exceptionDetails.exception.description || "Element not found");
				}

				const { x, y } = result.result.value;
				console.log("[NativeInput] Clicking at coordinates:", { x, y });

				// Dispatch trusted mouse events
				const pressResult = await browser.debugger.sendCommand({ tabId: this.tabId }, "Input.dispatchMouseEvent", {
					type: "mousePressed",
					x,
					y,
					button: "left",
					clickCount: 1,
				});
				console.log("[NativeInput] Mouse pressed result:", pressResult);

				const releaseResult = await browser.debugger.sendCommand({ tabId: this.tabId }, "Input.dispatchMouseEvent", {
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
				const focusResult = await browser.debugger.sendCommand(
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
				);

				console.log("[NativeInput] Focus result:", focusResult);

				if (focusResult.exceptionDetails) {
					console.error("[NativeInput] Element not found for typing:", focusResult.exceptionDetails);
					throw new Error(focusResult.exceptionDetails.exception.description || "Element not found");
				}

				// Type each character
				for (const char of message.text) {
					await browser.debugger.sendCommand({ tabId: this.tabId }, "Input.dispatchKeyEvent", {
						type: "keyDown",
						text: char,
					});

					await browser.debugger.sendCommand({ tabId: this.tabId }, "Input.dispatchKeyEvent", {
						type: "keyUp",
						text: char,
					});
				}

				console.log("[NativeInput] Typing completed successfully");
				respond({ success: true });
			} else if (message.action === "press") {
				console.log("[NativeInput] Pressing key:", message.key);

				// Press single key
				const keyDownResult = await browser.debugger.sendCommand({ tabId: this.tabId }, "Input.dispatchKeyEvent", {
					type: "keyDown",
					key: message.key,
				});
				console.log("[NativeInput] Key down result:", keyDownResult);

				const keyUpResult = await browser.debugger.sendCommand({ tabId: this.tabId }, "Input.dispatchKeyEvent", {
					type: "keyUp",
					key: message.key,
				});
				console.log("[NativeInput] Key up result:", keyUpResult);

				console.log("[NativeInput] Key press completed successfully");
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
		return "Native input events provider (for trusted browser events)";
	}
}
