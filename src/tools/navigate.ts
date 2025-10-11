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
		url: Type.String({ description: "URL to navigate to" }),
	}),
	Type.Object({
		history: Type.Union([Type.Literal("back"), Type.Literal("forward")], {
			description: "Navigate browser history",
		}),
	}),
]);

export type NavigateParams = Static<typeof navigateSchema>;

export interface NavigateResult {
	finalUrl: string;
	title: string;
	favicon?: string;
	skills: Array<{ name: string; shortDescription: string }>;
}

// ============================================================================
// TOOL
// ============================================================================

export class NavigateTool implements AgentTool<typeof navigateSchema, NavigateResult> {
	label = "Navigate";
	name = "navigate";
	description = `Navigate to URLs or use browser history.

Use { url: "https://example.com" } to navigate to a URL.
Use { history: "back" } or { history: "forward" } for browser history.

Returns final URL, page title, and available skills.

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

		// Get active tab
		const [tab] = await browser.tabs.query({
			active: true,
			currentWindow: true,
		});

		if (!tab || !tab.id) {
			throw new Error("No active tab found");
		}

		let finalUrl: string;

		markNavigationStart();
		try {
			if ("url" in args) {
				// Navigate to URL
				finalUrl = await this.navigateToUrl(tab.id, args.url, signal);
			} else {
				// Navigate history
				finalUrl = await this.navigateHistory(tab.id, args.history, signal);
			}
		} finally {
			markNavigationEnd();
		}

		// Get updated tab info
		const updatedTab = await browser.tabs.get(tab.id);
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
		let output = `Navigated to: ${finalUrl}\n`;
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

			// Set up navigation completion listener
			const listener = (
				details: chrome.webNavigation.WebNavigationFramedCallbackDetails,
			) => {
				if (details.tabId === tabId && details.frameId === 0) {
					browser.webNavigation.onCompleted.removeListener(listener);
					if (abortListener) signal?.removeEventListener("abort", abortListener);
					resolve(details.url);
				}
			};

			// Set up abort listener
			const abortListener = () => {
				if (browser.webNavigation?.onCompleted) {
					browser.webNavigation.onCompleted.removeListener(listener);
				}
				reject(new Error("Aborted"));
			};

			if (signal) {
				signal.addEventListener("abort", abortListener);
			}

			chrome.webNavigation.onCompleted.addListener(listener);

			// Trigger navigation
			browser.tabs.update(tabId, { url }).catch((err: Error) => {
				if (browser.webNavigation?.onCompleted) {
					browser.webNavigation.onCompleted.removeListener(listener);
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
					resolve(details.url);
				}
			};

			// Set up abort listener
			const abortListener = () => {
				if (browser.webNavigation?.onCompleted) {
					browser.webNavigation.onCompleted.removeListener(listener);
			}
				reject(new Error("Aborted"));
			};

			if (signal) {
				signal.addEventListener("abort", abortListener);
			}

			chrome.webNavigation.onCompleted.addListener(listener);

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
					reject(err);
				});
		});
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
			const displayText =
				"url" in params
					? params.url
					: `history.${params.history}()`;

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
			const { finalUrl, title, favicon, skills } = result.details;
			const faviconUrl = favicon || getFallbackFavicon(finalUrl);

			// Convert skills to Skill objects for SkillPill
			const skillObjects: Skill[] = skills.map((s) => ({
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
