import { html, i18n, icon } from "@mariozechner/mini-lit";
import type { AgentTool, ToolResultMessage } from "@mariozechner/pi-ai";
import {
	type Agent,
	registerToolRenderer,
	type ToolRenderResult,
	type ToolRenderer,
} from "@mariozechner/pi-web-ui";
import { type Static, Type } from "@sinclair/typebox";
import { Loader2 } from "lucide";
import { SkillPill } from "../components/SkillPill.js";
import { getSitegeistStorage } from "../storage/app-storage.js";
import type { Skill } from "../storage/stores/skills-store.js";
import "../utils/i18n-extension.js";

// Cross-browser API compatibility
// @ts-expect-error - browser global exists in Firefox, chrome in Chrome
const browser = globalThis.browser || globalThis.chrome;

// Track tool-initiated navigations to filter out duplicate navigation messages
let isNavigating = false;

export function isToolNavigating(): boolean {
	return isNavigating;
}

function markNavigationStart() {
	isNavigating = true;
}

function markNavigationEnd() {
	isNavigating = false;
}

// ============================================================================
// TYPES
// ============================================================================

const navigateSchema = Type.Union([
	Type.Object({
		url: Type.String({ description: "URL to navigate to in current tab" }),
	}),
	Type.Object({
		url: Type.String({ description: "URL to open in new tab" }),
		newTab: Type.Literal(true, { description: "Open in new tab" }),
	}),
	Type.Object({
		history: Type.Union([Type.Literal("back"), Type.Literal("forward")], {
			description: "Navigate browser history",
		}),
	}),
	Type.Object({
		listTabs: Type.Literal(true, { description: "List all open tabs" }),
	}),
	Type.Object({
		switchToTab: Type.Number({ description: "Tab ID to switch to" }),
	}),
]);

export type NavigateParams = Static<typeof navigateSchema>;

export interface TabInfo {
	id: number;
	url: string;
	title: string;
	active: boolean;
	favicon?: string;
}

export interface NavigateResult {
	finalUrl?: string;
	title?: string;
	favicon?: string;
	skills?: Array<{ name: string; shortDescription: string }>;
	tabs?: TabInfo[];
	switchedToTab?: number;
}

// ============================================================================
// TOOL
// ============================================================================

export class NavigateTool implements AgentTool<typeof navigateSchema, NavigateResult> {
	label = "Navigate";
	name = "navigate";
	description = `Navigate to URLs, manage tabs, or use browser history.

Actions:
- { url: "https://example.com" } - Navigate to URL in current tab
- { url: "https://example.com", newTab: true } - Open URL in new tab
- { history: "back" } or { history: "forward" } - Navigate browser history
- { listTabs: true } - List all open tabs with IDs, URLs, and titles
- { switchToTab: <tabId> } - Switch to a specific tab by its ID

Returns final URL, page title, and available skills.

Examples:
- Open Google in new tab: { url: "https://google.com", newTab: true }
- List all tabs: { listTabs: true }
- Switch to tab 123: { switchToTab: 123 }

CRITICAL: Use this instead of window.location, history.back/forward in browser_javascript.`;
	parameters = navigateSchema;

	constructor(private agent: Agent) {}

	async execute(
		_toolCallId: string,
		args: NavigateParams,
		signal?: AbortSignal,
	): Promise<{ output: string; details: NavigateResult }> {
		if (signal?.aborted) {
			throw new Error("Navigation aborted");
		}

		// Handle list tabs action
		if ("listTabs" in args) {
			return this.listTabs();
		}

		// Handle switch tab action
		if ("switchToTab" in args) {
			return this.switchToTab(args.switchToTab);
		}

		// Get active tab for navigation actions
		const [tab] = await browser.tabs.query({
			active: true,
			currentWindow: true,
		});

		if (!tab || !tab.id) {
			throw new Error("No active tab found");
		}

		let finalUrl: string;
		let targetTabId = tab.id;

		markNavigationStart();
		try {
			if ("url" in args) {
				// Check if opening in new tab
				if ("newTab" in args && args.newTab) {
					finalUrl = await this.openInNewTab(args.url, signal);
					// Get the newly created tab
					const tabs = await browser.tabs.query({});
					const newTab = tabs.find((t: chrome.tabs.Tab) => t.url === finalUrl);
					if (newTab?.id) {
						targetTabId = newTab.id;
					}
				} else {
					// Navigate to URL in current tab
					finalUrl = await this.navigateToUrl(tab.id, args.url, signal);
				}
			} else if ("history" in args) {
				// Navigate history
				finalUrl = await this.navigateHistory(tab.id, args.history, signal);
			} else {
				throw new Error("Invalid navigation parameters");
			}
		} finally {
			markNavigationEnd();
		}

		// Get updated tab info
		const updatedTab = await browser.tabs.get(targetTabId);
		const title = updatedTab.title || "Untitled";
		const favicon = updatedTab.favIconUrl;

		// Get skills for the final URL
		const skillsRepo = getSitegeistStorage().skills;
		const matchingSkills = await skillsRepo.getSkillsForUrl(finalUrl);
		const skills = matchingSkills.map((s) => ({
			name: s.name,
			shortDescription: s.shortDescription,
		}));

		const details: NavigateResult = {
			finalUrl,
			title,
			favicon,
			skills,
		};

		// Build output message
		let output = "";
		if ("newTab" in args && args.newTab) {
			output = `Opened in new tab: ${finalUrl}\n`;
		} else {
			output = `Navigated to: ${finalUrl}\n`;
		}

		if (skills.length > 0) {
			output += "Available skills:\n";
			for (const skill of skills) {
				output += `  - ${skill.name}: ${skill.shortDescription}\n`;
			}
		} else {
			output += "No skills found for domain";
		}

		return { output, details };
	}

	private async navigateToUrl(
		tabId: number,
		url: string,
		signal?: AbortSignal,
	): Promise<string> {
		return new Promise((resolve, reject) => {
			if (signal?.aborted) {
				reject(new Error("Aborted"));
				return;
			}

			// Set up DOMContentLoaded listener (fires when DOM is ready, more reliable than onCompleted)
			const listener = (
				details: chrome.webNavigation.WebNavigationFramedCallbackDetails,
			) => {
				if (details.tabId === tabId && details.frameId === 0) {
					browser.webNavigation.onDOMContentLoaded.removeListener(listener);
					if (abortListener) signal?.removeEventListener("abort", abortListener);
					resolve(details.url);
				}
			};

			// Set up abort listener
			const abortListener = () => {
				if (browser.webNavigation?.onDOMContentLoaded) {
					browser.webNavigation.onDOMContentLoaded.removeListener(listener);
				}
				reject(new Error("Aborted"));
			};

			if (signal) {
				signal.addEventListener("abort", abortListener);
			}

			chrome.webNavigation.onDOMContentLoaded.addListener(listener);

			// Trigger navigation
			browser.tabs.update(tabId, { url }).catch((err: Error) => {
				if (browser.webNavigation?.onDOMContentLoaded) {
					browser.webNavigation.onDOMContentLoaded.removeListener(listener);
				}
				if (abortListener) signal?.removeEventListener("abort", abortListener);
				reject(err);
			});
		});
	}

	private async navigateHistory(
		tabId: number,
		direction: "back" | "forward",
		signal?: AbortSignal,
	): Promise<string> {
		if (signal?.aborted) {
			throw new Error("Aborted");
		}

		// First check if there's history available in that direction
		const [result] = await browser.scripting.executeScript({
			target: { tabId: tabId },
			func: (dir: "back" | "forward") => {
				const canNavigate = dir === "back" ? history.length > 1 : false; // Can't reliably detect forward
				return { canNavigate, currentUrl: location.href };
			},
			args: [direction],
		});

		const { canNavigate, currentUrl } = result.result as { canNavigate: boolean; currentUrl: string };

		// For back navigation, we can check. For forward, we can't know for sure, so we try anyway
		if (direction === "back" && !canNavigate) {
			// No history to go back to, return current URL immediately
			return currentUrl;
		}

		// Attempt navigation
		return new Promise((resolve, reject) => {
			if (signal?.aborted) {
				reject(new Error("Aborted"));
				return;
			}

			// Set up navigation completion listener
			const listener = (
				details: chrome.webNavigation.WebNavigationFramedCallbackDetails,
			) => {
				if (details.tabId === tabId && details.frameId === 0) {
					browser.webNavigation.onCompleted.removeListener(listener);
					if (abortListener) signal?.removeEventListener("abort", abortListener);
					if (timeout) clearTimeout(timeout);
					resolve(details.url);
				}
			};

			// Set up abort listener
			const abortListener = () => {
				if (browser.webNavigation?.onCompleted) {
					browser.webNavigation.onCompleted.removeListener(listener);
				}
				if (timeout) clearTimeout(timeout);
				reject(new Error("Aborted"));
			};

			if (signal) {
				signal.addEventListener("abort", abortListener);
			}

			chrome.webNavigation.onCompleted.addListener(listener);

			// Set a timeout to detect if navigation didn't happen (no history available for forward)
			const timeout = setTimeout(() => {
				browser.webNavigation.onCompleted.removeListener(listener);
				if (abortListener) signal?.removeEventListener("abort", abortListener);
				// Navigation didn't happen, return current URL
				resolve(currentUrl);
			}, 1000); // 1 second timeout

			// Execute history navigation in the page
			browser.scripting
				.executeScript({
					target: { tabId: tabId },
					func: (dir: "back" | "forward") => {
						history[dir]();
					},
					args: [direction],
				})
				.catch((err: Error) => {
					browser.webNavigation.onCompleted.removeListener(listener);
					if (abortListener) signal?.removeEventListener("abort", abortListener);
					if (timeout) clearTimeout(timeout);
					reject(err);
				});
		});
	}

	private async openInNewTab(url: string, signal?: AbortSignal): Promise<string> {
		if (signal?.aborted) {
			throw new Error("Aborted");
		}

		const newTab = await browser.tabs.create({ url, active: true });

		if (!newTab.id) {
			throw new Error("Failed to create new tab");
		}

		// Wait for the tab to load
		return new Promise((resolve, reject) => {
			if (signal?.aborted) {
				reject(new Error("Aborted"));
				return;
			}

			const listener = (
				details: chrome.webNavigation.WebNavigationFramedCallbackDetails,
			) => {
				if (details.tabId === newTab.id && details.frameId === 0) {
					browser.webNavigation.onDOMContentLoaded.removeListener(listener);
					if (abortListener) signal?.removeEventListener("abort", abortListener);
					resolve(details.url);
				}
			};

			const abortListener = () => {
				if (browser.webNavigation?.onDOMContentLoaded) {
					browser.webNavigation.onDOMContentLoaded.removeListener(listener);
				}
				reject(new Error("Aborted"));
			};

			if (signal) {
				signal.addEventListener("abort", abortListener);
			}

			chrome.webNavigation.onDOMContentLoaded.addListener(listener);
		});
	}

	private async listTabs(): Promise<{ output: string; details: NavigateResult }> {
		const tabs = await browser.tabs.query({});

		const tabInfos: TabInfo[] = tabs
			.filter((t: chrome.tabs.Tab): t is chrome.tabs.Tab & { id: number; url: string } =>
				t.id !== undefined && t.url !== undefined
			)
			.map((t: chrome.tabs.Tab & { id: number; url: string }) => ({
				id: t.id,
				url: t.url,
				title: t.title || "Untitled",
				active: t.active || false,
				favicon: t.favIconUrl,
			}));

		const details: NavigateResult = {
			tabs: tabInfos,
		};

		let output = `Found ${tabInfos.length} open tabs:\n`;
		for (const tab of tabInfos) {
			const activeMarker = tab.active ? " [ACTIVE]" : "";
			output += `  - Tab ${tab.id}: ${tab.title}${activeMarker}\n`;
			output += `    URL: ${tab.url}\n`;
		}

		return { output, details };
	}

	private async switchToTab(tabId: number): Promise<{ output: string; details: NavigateResult }> {
		// Get the tab to switch to
		const tab = await browser.tabs.get(tabId);

		if (!tab) {
			throw new Error(`Tab ${tabId} not found`);
		}

		// Activate the tab
		await browser.tabs.update(tabId, { active: true });

		// Focus the window containing the tab
		if (tab.windowId) {
			await browser.windows.update(tab.windowId, { focused: true });
		}

		const finalUrl = tab.url || "";
		const title = tab.title || "Untitled";
		const favicon = tab.favIconUrl;

		// Get skills for the tab's URL
		const skillsRepo = getSitegeistStorage().skills;
		const matchingSkills = finalUrl ? await skillsRepo.getSkillsForUrl(finalUrl) : [];
		const skills = matchingSkills.map((s) => ({
			name: s.name,
			shortDescription: s.shortDescription,
		}));

		const details: NavigateResult = {
			finalUrl,
			title,
			favicon,
			skills,
			switchedToTab: tabId,
		};

		let output = `Switched to tab ${tabId}: ${title}\n`;
		output += `URL: ${finalUrl}\n`;

		if (skills.length > 0) {
			output += "Available skills:\n";
			for (const skill of skills) {
				output += `  - ${skill.name}: ${skill.shortDescription}\n`;
			}
		} else {
			output += "No skills found for domain";
		}

		return { output, details };
	}
}

// ============================================================================
// RENDERER
// ============================================================================

function getFallbackFavicon(url: string): string {
	try {
		const urlObj = new URL(url);
		return `https://www.google.com/s2/favicons?domain=${urlObj.hostname}&sz=32`;
	} catch {
		return "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Cpath fill='%23999' d='M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z'/%3E%3C/svg%3E";
	}
}

export const navigateRenderer: ToolRenderer<NavigateParams, NavigateResult> = {
	render(
		params: NavigateParams | undefined,
		result: ToolResultMessage<NavigateResult> | undefined,
		isStreaming?: boolean,
	): ToolRenderResult {
		// Loading state (params but no result)
		if (params && !result) {
			let displayText = "";
			if ("url" in params) {
				displayText = params.url;
			} else if ("history" in params) {
				displayText = `history.${params.history}()`;
			} else if ("listTabs" in params) {
				displayText = "Listing tabs...";
			} else if ("switchToTab" in params) {
				displayText = `Switching to tab ${params.switchToTab}`;
			}

			return {
				content: html`
					<div class="my-2">
						<div
							class="inline-flex items-center gap-2 px-3 py-2 text-sm text-card-foreground bg-card border border-border rounded-lg max-w-full shadow-lg"
						>
							<div class="w-4 h-4 flex-shrink-0 flex items-center justify-center">
								${icon(Loader2, "sm", "animate-spin")}
							</div>
							<span class="truncate font-medium">${i18n("Navigating to")} ${displayText}</span>
						</div>
					</div>
				`,
				isCustom: true,
			};
		}

		// Complete state (with result)
		if (result && !result.isError && result.details) {
			const { finalUrl, title, favicon, skills, tabs, switchedToTab } = result.details;

			// Handle tab listing
			if (tabs) {
				return {
					content: html`
						<div class="my-2 space-y-2">
							<div class="text-sm font-medium text-muted-foreground">Open tabs (${tabs.length}):</div>
							${tabs.map((tab) => html`
								<div class="flex items-center gap-2 px-3 py-2 text-sm bg-card border border-border rounded-lg">
									${tab.favicon ? html`<img src="${tab.favicon}" alt="" class="w-4 h-4 flex-shrink-0" />` : ""}
									<span class="truncate flex-1">${tab.title}</span>
									<span class="text-xs text-muted-foreground">Tab ${tab.id}</span>
									${tab.active ? html`<span class="text-xs text-primary font-medium">[ACTIVE]</span>` : ""}
								</div>
							`)}
						</div>
					`,
					isCustom: true,
				};
			}

			// Handle navigation/switch results
			if (finalUrl && title) {
				const faviconUrl = favicon || getFallbackFavicon(finalUrl);

				// Convert skills to Skill objects for SkillPill
				const skillObjects: Skill[] = (skills || []).map((s) => ({
					name: s.name,
					shortDescription: s.shortDescription,
					description: "",
					examples: "",
					library: "",
					domainPatterns: [],
					createdAt: new Date().toISOString(),
					lastUpdated: new Date().toISOString(),
				}));

				return {
					content: html`
						<div class="my-2 space-y-2">
							<button
								class="inline-flex items-center gap-2 px-3 py-2 text-sm text-card-foreground bg-card border border-border rounded-lg hover:bg-accent/50 transition-colors max-w-full cursor-pointer shadow-lg"
								@click=${() => browser.tabs.create({ url: finalUrl })}
								title="${i18n("Click to open")}: ${finalUrl}"
							>
								<img src="${faviconUrl}" alt="" class="w-4 h-4 flex-shrink-0" />
								<span class="truncate font-medium">${title}</span>
							</button>
							${skillObjects.length > 0
								? html`
										<div class="flex flex-wrap gap-2">
											${skillObjects.map((s) => SkillPill(s, true))}
										</div>
								  `
								: ""}
						</div>
					`,
					isCustom: true,
				};
			}
		}

		// Error state
		if (result?.isError) {
			return {
				content: html`
					<div class="my-2">
						<div class="text-sm text-destructive">${result.output}</div>
					</div>
				`,
				isCustom: true,
			};
		}

		// Waiting state
		return {
			content: html`<div class="my-2 text-sm text-muted-foreground">${i18n("Waiting...")}</div>`,
			isCustom: true,
		};
	},
};

// Auto-register renderer
registerToolRenderer("navigate", navigateRenderer);
