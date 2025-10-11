import { html, i18n, icon, type TemplateResult } from "@mariozechner/mini-lit";
import "@mariozechner/mini-lit/dist/MarkdownBlock.js";
import {
	type AgentTool,
	StringEnum,
	type ToolResultMessage,
} from "@mariozechner/pi-ai";
import {
	registerToolRenderer,
	renderHeader,
	SandboxIframe,
	type ToolRenderer,
	type ToolRenderResult,
} from "@mariozechner/pi-web-ui";
import { type Static, Type } from "@sinclair/typebox";
import { Sparkles } from "lucide";
import { DomainPill } from "../components/DomainPill.js";
import { SkillPill } from "../components/SkillPill.js";
import { SKILL_TOOL_DESCRIPTION } from "../prompts/tool-prompts.js";
import { getSitegeistStorage } from "../storage/app-storage.js";
import type { Skill } from "../storage/stores/skills-store.js";

// Cross-browser API
// @ts-expect-error
const browser = globalThis.browser || globalThis.chrome;

const getSkills = () => getSitegeistStorage().skills;

// Default skills shipped with the extension
const defaultSkills: Skill[] = [
	{
		name: "google",
		domainPatterns: ["google.com", "google.*/search*"],
		shortDescription:
			"Extract Google search results with titles, URLs, snippets, and metadata",
		description: `Extracts structured data from Google search result pages.

**Returns:**
- Array of search results with title, URL, snippet, and position
- Total result count estimate
- Related searches
- Featured snippets when available

**Limitations:**
- Only works on search result pages (not Google homepage)
- May not capture all rich result types (shopping, images, etc.)`,
		examples: `// Get all search results on the page
const results = google.getSearchResults();
console.log(\`Found \${results.items.length} results\`);

// Access individual results
results.items.forEach((item, i) => {
  console.log(\`\${i + 1}. \${item.title}\`);
  console.log(\`   \${item.url}\`);
  console.log(\`   \${item.snippet}\`);
});

// Get result count
console.log(\`Total results: \${results.resultCount}\`);

// Get related searches
console.log('Related:', results.relatedSearches);`,
		library: `// Google Search Results Extractor
window.google = {
  getSearchResults() {
    const results = {
      items: [],
      resultCount: null,
      relatedSearches: [],
      featuredSnippet: null
    };

    // Get result count
    const resultStats = document.querySelector('#result-stats');
    if (resultStats) {
      const match = resultStats.textContent.match(/([\\d,]+)\\s+results/);
      if (match) {
        results.resultCount = match[1];
      }
    }

    // Get main search results
    const searchResults = document.querySelectorAll('#search .g, #rso > div > div');
    searchResults.forEach((result, index) => {
      const titleEl = result.querySelector('h3');
      const linkEl = result.querySelector('a');
      const snippetEl = result.querySelector('.VwiC3b, .s3v9rd, [data-sncf]');

      if (titleEl && linkEl) {
        results.items.push({
          position: index + 1,
          title: titleEl.textContent,
          url: linkEl.href,
          snippet: snippetEl ? snippetEl.textContent : ''
        });
      }
    });

    // Get featured snippet if present
    const featured = document.querySelector('.kp-blk, .ifM9O');
    if (featured) {
      results.featuredSnippet = featured.textContent.trim();
    }

    // Get related searches
    const relatedSection = document.querySelector('[data-hveid][data-ved] h3');
    if (relatedSection && relatedSection.textContent.includes('Related searches')) {
      const relatedLinks = relatedSection.parentElement.parentElement.querySelectorAll('a');
      relatedLinks.forEach(link => {
        results.relatedSearches.push(link.textContent.trim());
      });
    }

    return results;
  }
};`,
		createdAt: new Date().toISOString(),
		lastUpdated: new Date().toISOString(),
	},
	{
		createdAt: "2025-10-08T10:18:31.396Z",
		description:
			"Comprehensive YouTube skill for automating video interactions and data extraction.\n\n**Features:**\n- Video playback controls (play/pause, seek, get time/duration)\n- Extract video information (title, channel, views, likes, description)\n- Get full transcripts with timestamps\n- Fetch comments with author, likes, and timestamps\n- Channel info and subscription management\n- Playlist navigation (next/previous video)\n- UI controls (theater mode, fullscreen, captions)\n- Search videos\n\n**Limitations:**\n- Some functions require being on a video page (e.g., playback controls, transcript)\n- Transcript requires manual loading (clicks button automatically)\n- Comments require scrolling to load (done automatically)\n- Description and transcript may take a moment to load",
		domainPatterns: [
			"youtube.com",
			"www.youtube.com",
			"m.youtube.com",
			"youtu.be",
		],
		examples:
			"// Video Controls\nwindow.yt.playVideo();\nwindow.yt.pauseVideo();\nwindow.yt.seekTo(30);\nconst time = window.yt.getCurrentTime();\nconst duration = window.yt.getDuration();\n\n// Video Information\nconst info = window.yt.getVideoInfo();\nconst videoId = window.yt.getVideoId();\nconst desc = window.yt.getVideoDescription();\n\n// Transcript\nconst transcript = await window.yt.getTranscript();\n// Returns: [{timestamp: '0:00', text: '...'}, ...]\n\n// Comments\nconst comments = await window.yt.getComments(10);\n// Returns: [{author, text, likes, time}, ...]\n\n// Channel\nconst channelInfo = window.yt.getChannelInfo();\nwindow.yt.subscribeToChannel();\nwindow.yt.clickBellIcon();\n\n// Playlist Navigation\nwindow.yt.nextVideo();\nwindow.yt.previousVideo();\nconst playlist = window.yt.getPlaylistVideos();\n\n// UI Controls\nwindow.yt.toggleTheater();\nwindow.yt.toggleFullscreen();\nwindow.yt.toggleCaptions();\n\n// Search\nwindow.yt.searchVideos('Linus Tech Tips');",
		lastUpdated: "2025-10-08T10:18:31.396Z",
		library:
			"window.yt = {\n  // ===== Video Controls =====\n  playVideo: function() {\n    const video = document.querySelector('video');\n    if (!video) return 'No video found';\n    video.play();\n    return 'Playing';\n  },\n\n  pauseVideo: function() {\n    const video = document.querySelector('video');\n    if (!video) return 'No video found';\n    video.pause();\n    return 'Paused';\n  },\n\n  seekTo: function(seconds) {\n    const video = document.querySelector('video');\n    if (!video) return 'No video found';\n    video.currentTime = seconds;\n    return `Seeked to ${seconds}s`;\n  },\n\n  getCurrentTime: function() {\n    const video = document.querySelector('video');\n    if (!video) return 'No video found';\n    return video.currentTime;\n  },\n\n  getDuration: function() {\n    const video = document.querySelector('video');\n    if (!video) return 'No video found';\n    return video.duration;\n  },\n\n  // ===== Video Information =====\n  getVideoInfo: function() {\n    const title = document.querySelector('h1.ytd-watch-metadata yt-formatted-string')?.textContent?.trim();\n    const channel = document.querySelector('ytd-channel-name yt-formatted-string a')?.textContent?.trim();\n    const views = document.querySelector('ytd-video-view-count-renderer span.view-count')?.textContent?.trim();\n    const likes = document.querySelector('like-button-view-model button[aria-label*=\"like\"]')?.getAttribute('aria-label');\n    const uploadDate = document.querySelector('ytd-video-primary-info-renderer #info-strings yt-formatted-string')?.textContent?.trim();\n    \n    return { title, channel, views, likes, uploadDate };\n  },\n\n  getVideoId: function() {\n    const urlParams = new URLSearchParams(window.location.search);\n    return urlParams.get('v');\n  },\n\n  getVideoDescription: function() {\n    const descElement = document.querySelector('ytd-text-inline-expander yt-attributed-string');\n    return descElement?.textContent?.trim() || 'Description not loaded';\n  },\n\n  // ===== Transcript =====\n  getTranscript: async function() {\n    // Find and click transcript button if not already open\n    let segments = document.querySelectorAll('ytd-transcript-segment-renderer');\n    \n    if (segments.length === 0) {\n      const buttons = document.querySelectorAll('button, yt-button-shape button, ytd-button-renderer button');\n      let transcriptButton = null;\n      \n      for (let btn of buttons) {\n        const text = btn.textContent || btn.getAttribute('aria-label') || '';\n        if (text.includes('transcript') || text.includes('Transcript')) {\n          transcriptButton = btn;\n          break;\n        }\n      }\n      \n      if (transcriptButton) {\n        transcriptButton.click();\n        await new Promise(resolve => setTimeout(resolve, 1500));\n      }\n    }\n    \n    segments = document.querySelectorAll('ytd-transcript-segment-renderer');\n    \n    if (segments.length === 0) {\n      return 'Transcript not available for this video';\n    }\n    \n    const transcript = Array.from(segments).map(seg => ({\n      timestamp: seg.querySelector('.segment-timestamp')?.textContent?.trim(),\n      text: seg.querySelector('.segment-text')?.textContent?.trim()\n    }));\n    \n    return transcript;\n  },\n\n  // ===== Comments =====\n  getComments: async function(limit = 10) {\n    const commentsSection = document.querySelector('ytd-comments#comments');\n    if (commentsSection) {\n      commentsSection.scrollIntoView({ behavior: 'smooth' });\n      await new Promise(resolve => setTimeout(resolve, 2000));\n    }\n    \n    const commentRenderers = document.querySelectorAll('ytd-comment-thread-renderer');\n    \n    if (commentRenderers.length === 0) {\n      return 'Comments not loaded yet';\n    }\n    \n    const comments = Array.from(commentRenderers).slice(0, limit).map(renderer => {\n      const author = renderer.querySelector('#author-text span')?.textContent?.trim();\n      const text = renderer.querySelector('#content-text')?.textContent?.trim();\n      const likes = renderer.querySelector('#vote-count-middle')?.textContent?.trim();\n      const time = renderer.querySelector('.published-time-text a')?.textContent?.trim();\n      \n      return { author, text, likes, time };\n    });\n    \n    return comments;\n  },\n\n  // ===== Channel & Subscription =====\n  getChannelInfo: function() {\n    const channelName = document.querySelector('ytd-channel-name yt-formatted-string a')?.textContent?.trim();\n    const subscriberCount = document.querySelector('#owner-sub-count')?.textContent?.trim();\n    const channelUrl = document.querySelector('ytd-channel-name a')?.href;\n    \n    return {\n      name: channelName,\n      subscribers: subscriberCount,\n      url: channelUrl\n    };\n  },\n\n  subscribeToChannel: function() {\n    const subButton = document.querySelector('ytd-subscribe-button-renderer button, #subscribe-button button');\n    if (!subButton) return 'Subscribe button not found';\n    \n    subButton.click();\n    return 'Clicked subscribe button';\n  },\n\n  clickBellIcon: function() {\n    const bellButton = document.querySelector('ytd-subscription-notification-toggle-button-renderer-next button');\n    if (!bellButton) return 'Bell button not found';\n    \n    bellButton.click();\n    return 'Clicked notification bell';\n  },\n\n  // ===== Playlist & Queue =====\n  nextVideo: function() {\n    const nextButton = document.querySelector('.ytp-next-button');\n    if (!nextButton) return 'Next button not found';\n    \n    nextButton.click();\n    return 'Playing next video';\n  },\n\n  previousVideo: function() {\n    const prevButton = document.querySelector('.ytp-prev-button');\n    if (!prevButton) return 'Previous button not found';\n    \n    prevButton.click();\n    return 'Playing previous video';\n  },\n\n  addToPlaylist: function() {\n    const saveButtons = document.querySelectorAll('button[aria-label]');\n    let saveButton = null;\n    \n    for (let btn of saveButtons) {\n      const label = btn.getAttribute('aria-label');\n      if (label && (label.includes('Save') || label.includes('save'))) {\n        saveButton = btn;\n        break;\n      }\n    }\n    \n    if (!saveButton) return 'Save button not found';\n    \n    saveButton.click();\n    return 'Opened save to playlist menu';\n  },\n\n  getPlaylistVideos: function() {\n    const playlistItems = document.querySelectorAll('ytd-playlist-panel-renderer ytd-playlist-panel-video-renderer');\n    \n    if (playlistItems.length === 0) {\n      return 'Not in a playlist or playlist not visible';\n    }\n    \n    const videos = Array.from(playlistItems).map(item => ({\n      title: item.querySelector('#video-title')?.textContent?.trim(),\n      channel: item.querySelector('#channel-name')?.textContent?.trim(),\n      duration: item.querySelector('#text.ytd-thumbnail-overlay-time-status-renderer')?.textContent?.trim()\n    }));\n    \n    return videos;\n  },\n\n  // ===== UI Controls =====\n  toggleTheater: function() {\n    const theaterBtn = document.querySelector('.ytp-size-button');\n    if (!theaterBtn) return 'Theater button not found';\n    \n    theaterBtn.click();\n    return 'Theater mode toggled';\n  },\n\n  toggleFullscreen: function() {\n    const fullscreenBtn = document.querySelector('.ytp-fullscreen-button');\n    if (!fullscreenBtn) return 'Fullscreen button not found';\n    \n    fullscreenBtn.click();\n    return 'Fullscreen toggled';\n  },\n\n  toggleCaptions: function() {\n    const captionsBtn = document.querySelector('.ytp-subtitles-button');\n    if (!captionsBtn) return 'Captions button not found';\n    \n    captionsBtn.click();\n    return 'Captions toggled';\n  },\n\n  // ===== Search =====\n  searchVideos: function(query) {\n    const searchBox = document.querySelector('input[name=\"search_query\"]');\n    const searchForm = searchBox?.closest('form');\n    \n    if (!searchBox || !searchForm) {\n      return 'Search not available';\n    }\n    \n    searchBox.value = query;\n    searchForm.submit();\n    return `Searching for: ${query}`;\n  }\n};",
		name: "youtube",
		shortDescription:
			"Complete YouTube automation - video controls, info extraction, transcripts, comments, playlists, and more",
	},
];

// Initialize default skills on first run
export async function initializeDefaultSkills() {
	const skillsRepo = getSkills();
	for (const skill of defaultSkills) {
		const existing = await skillsRepo.getSkill(skill.name);
		if (!existing) {
			await skillsRepo.saveSkill(skill);
		}
	}
}

// Get sandbox URL for CSP-compliant code validation
const getSandboxUrl = () => {
	return browser.runtime.getURL("sandbox.html");
};

/**
 * Validate JavaScript syntax using sandboxed iframe (CSP-compliant).
 * Returns { valid: true } or { valid: false, error: string }
 */
async function validateJavaScriptSyntax(
	code: string,
): Promise<{ valid: boolean; error?: string }> {
	const sandbox = new SandboxIframe();
	sandbox.sandboxUrlProvider = getSandboxUrl;
	sandbox.style.display = "none";
	document.body.appendChild(sandbox);

	try {
		const result = await sandbox.execute(
			`syntax-check-${Date.now()}`,
			code,
			[],
		);
		sandbox.remove();

		if (!result.success && result.error) {
			return { valid: false, error: result.error.message };
		}

		return { valid: true };
	} catch (error: unknown) {
		sandbox.remove();
		return { valid: false, error: (error as Error).message || "Unknown error" };
	}
}

// IMPORTANT: Use StringEnum for Google API compatibility (NOT Type.Union!)
const skillParamsSchema = Type.Object({
	action: StringEnum(["get", "list", "create", "update", "delete"], {
		description: "Action to perform",
	}),
	name: Type.Optional(
		Type.String({ description: "Skill name (required for get/update/delete)" }),
	),
	url: Type.Optional(
		Type.String({
			description:
				"URL to filter skills by domain (optional for list action, defaults to current tab URL)",
		}),
	),
	includeLibraryCode: Type.Optional(
		Type.Boolean({
			description:
				"Use with 'get' action to include full library code in output (only necessary if you want to make changes to the library code of a skill)",
		}),
	),
	data: Type.Optional(
		Type.Object({
			name: Type.String({ description: "Unique skill name" }),
			domainPatterns: Type.Array(Type.String(), {
				description:
					"Array of glob patterns (e.g., ['youtube.com', 'youtu.be'] or ['github.com', 'github.com/*/issues']). Include short URLs and domain variations!",
			}),
			shortDescription: Type.String({
				description: "Brief one-line plain text description",
			}),
			description: Type.String({
				description:
					"Full markdown description (include gotchas/limitations, use markdown formatting)",
			}),
			examples: Type.String({
				description:
					"Plain JavaScript code examples (will be rendered in code block)",
			}),
			library: Type.String({ description: "JavaScript code to inject" }),
		}),
	),
});

type SkillParams = Static<typeof skillParamsSchema>;

export const skillTool: AgentTool<typeof skillParamsSchema, any> = {
	label: "Skill Management",
	name: "skill",
	description: SKILL_TOOL_DESCRIPTION,
	parameters: skillParamsSchema,
	execute: async (_toolCallId: string, args: SkillParams) => {
		try {
			const skillsRepo = getSkills();
			const [tab] = await browser.tabs.query({
				active: true,
				currentWindow: true,
			});
			const currentUrl = tab?.url || "";

			switch (args.action) {
				case "get": {
					if (!args.name) {
						return {
							output: "Missing 'name' parameter for get action.",
							isError: true,
							details: {},
						};
					}

					const skill = await skillsRepo.getSkill(args.name);
					if (!skill) {
						// Return list of available skills for current domain
						const available = await skillsRepo.listSkills(currentUrl);
						if (available.length === 0) {
							return {
								output: `Skill '${args.name}' not found. No skills available for current domain.`,
								isError: true,
								details: {},
							};
						}
						const list = available
							.map((s) => `${s.name}: ${s.shortDescription}`)
							.join("\n");
						return {
							output: `Skill '${args.name}' not found. Available skills:\n${list}`,
							isError: true,
							details: {},
						};
					}

					// Build output based on includeLibraryCode flag
					const domainsStr = skill.domainPatterns.join(", ");
					let llmOutput = `${skill.name} (${domainsStr})\n${skill.description}\n\nExamples:\n${skill.examples}`;

					// Only include library code if explicitly requested
					if (args.includeLibraryCode) {
						llmOutput += `\n\nLibrary:\n${skill.library}`;
					}

					return {
						output: llmOutput,
						isError: false,
						details: skill,
					};
				}

				case "list": {
					// Determine which URL to use for filtering
					// args.url === undefined -> use current tab URL (default)
					// args.url === "" -> list ALL skills (no filtering)
					// args.url === "https://..." -> use specified URL
					const filterUrl =
						args.url === undefined
							? currentUrl
							: args.url === ""
								? undefined
								: args.url;

					const skillList = await skillsRepo.listSkills(filterUrl);
					if (skillList.length === 0) {
						const msg = filterUrl
							? "No skills found for specified domain."
							: "No skills found.";
						return { output: msg, isError: false, details: { skills: [] } };
					}

					// Token-efficient list for LLM: name: short description
					const llmOutput = skillList
						.map((s) => `${s.name}: ${s.shortDescription}`)
						.join("\n");
					return {
						output: llmOutput,
						isError: false,
						details: { skills: skillList },
					};
				}

				case "create": {
					if (!args.data) {
						return {
							output: "Missing 'data' parameter for create.",
							isError: true,
							details: {},
						};
					}

					// Check if already exists
					const existing = await skillsRepo.getSkill(args.data.name);
					if (existing) {
						return {
							output: `Skill '${args.data.name}' already exists. Use update action to modify.`,
							isError: true,
							details: {},
						};
					}

					// Validate syntax using sandboxed iframe (CSP-compliant)
					/*const validation = await validateJavaScriptSyntax(args.data.library);
					if (!validation.valid) {
						return {
							output: `Syntax error in library: ${validation.error}`,
							isError: true,
							details: {},
						};
					}*/

					const now = new Date().toISOString();
					const newSkill: Skill = {
						name: args.data.name,
						domainPatterns: args.data.domainPatterns,
						shortDescription: args.data.shortDescription,
						description: args.data.description,
						createdAt: now,
						lastUpdated: now,
						examples: args.data.examples,
						library: args.data.library,
					};

					await skillsRepo.saveSkill(newSkill);

					return {
						output: `Skill '${args.data.name}' created.`,
						isError: false,
						details: newSkill,
					};
				}

				case "update": {
					if (!args.name) {
						return {
							output: "Missing 'name' parameter for update.",
							isError: true,
							details: {},
						};
					}
					if (!args.data) {
						return {
							output: "Missing 'data' parameter for update.",
							isError: true,
							details: {},
						};
					}

					const existing = await skillsRepo.getSkill(args.name);
					if (!existing) {
						return {
							output: `Skill '${args.name}' not found. Use create action.`,
							isError: true,
							details: {},
						};
					}

					// Validate library syntax if provided (using sandboxed iframe)
					if (args.data.library) {
						const validation = await validateJavaScriptSyntax(
							args.data.library,
						);
						if (!validation.valid) {
							return {
								output: `Syntax error in library: ${validation.error}`,
								isError: true,
								details: {},
							};
						}
					}

					// Merge with existing (only update provided fields)
					const updated: Skill = {
						...existing,
						...args.data,
						name: existing.name, // Name cannot be changed
						createdAt: existing.createdAt, // Keep original creation date
						lastUpdated: new Date().toISOString(),
					};

					await skillsRepo.saveSkill(updated);

					return {
						output: `Skill '${args.name}' updated.`,
						isError: false,
						details: updated,
					};
				}

				case "delete": {
					if (!args.name) {
						return {
							output: "Missing 'name' parameter for delete.",
							isError: true,
							details: {},
						};
					}

					const existing = await skillsRepo.getSkill(args.name);
					if (!existing) {
						return {
							output: `Skill '${args.name}' not found.`,
							isError: false,
							details: {},
						};
					}

					await skillsRepo.deleteSkill(args.name);
					return {
						output: `Skill '${args.name}' deleted.`,
						isError: false,
						details: { name: args.name },
					};
				}

				default:
					return {
						output: `Unknown action: ${(args as any).action}`,
						isError: true,
						details: {},
					};
			}
		} catch (error: any) {
			return { output: `Error: ${error.message}`, isError: true, details: {} };
		}
	},
};

// Renderer result types
interface SkillResultDetails {
	skills?: Skill[];
	name?: string;
	domainPatterns?: string[];
	shortDescription?: string;
	description?: string;
	examples?: string;
	library?: string;
}

export const skillRenderer: ToolRenderer<SkillParams, SkillResultDetails> = {
	render(
		params: SkillParams | undefined,
		result: ToolResultMessage<SkillResultDetails> | undefined,
	): ToolRenderResult {
		const state = result
			? result.isError
				? "error"
				: "complete"
			: "inprogress";

		// Helper to render domain pills
		const renderDomainPills = (patterns: string[]) => html`
			<div class="flex flex-wrap gap-2">
				${patterns.map((pattern) => DomainPill(pattern))}
			</div>
		`;

		// Helper to render skill fields (used by create/update/get)
		const renderSkillFields = (
			skill: Partial<Skill>,
			showLibrary: boolean,
		) => html`
			${skill.domainPatterns?.length ? renderDomainPills(skill.domainPatterns) : ""}
			${skill.shortDescription ? html`<div class="text-sm text-muted-foreground">${skill.shortDescription}</div>` : ""}
			${skill.description ? html`<markdown-block .content=${skill.description}></markdown-block>` : ""}
			${
				skill.examples
					? html`
				<div class="space-y-2">
					<div class="text-sm font-medium text-muted-foreground">${i18n("Examples")}</div>
					<code-block .code=${skill.examples} language="javascript"></code-block>
				</div>
			`
					: ""
			}
			${
				showLibrary && skill.library
					? html`
				<div class="space-y-2">
					<div class="text-sm font-medium text-muted-foreground">${i18n("Library")}</div>
					<code-block .code=${skill.library} language="javascript"></code-block>
				</div>
			`
					: ""
			}
		`;

		// Error handling
		if (result?.isError) {
			const action = params?.action;
			const skillName = params?.name || params?.data?.name;
			const labels: Record<string, string> = {
				get: i18n("Getting skill"),
				list: i18n("Listing skills"),
				create: i18n("Creating skill"),
				update: i18n("Updating skill"),
				delete: i18n("Deleting skill"),
			};
			const headerText = skillName
				? `${labels[action!] || action} ${skillName}`
				: labels[action!] || action || "";

			// For create/update errors, show partial skill data with error at bottom
			if ((action === "create" || action === "update") && params?.data) {
				return {content: html`
					<div class="space-y-3">
						${renderHeader(state, Sparkles, headerText)}
						${renderSkillFields(params.data, true)}
						<div class="w-full px-3 py-2 text-sm text-destructive bg-destructive/10 border border-destructive rounded">
							${result.output || ""}
						</div>
					</div>
				`, isCustom: false };
			}

			return {content: html`
				<div class="space-y-3">
					${renderHeader(state, Sparkles, headerText)}
					<div class="text-sm text-destructive">${result.output || ""}</div>
				</div>
			`, isCustom: false };
		}

		// Full params + result
		if (result && params) {
			const { action } = params;
			const skill = result.details;

			switch (action) {
				case "get": {
					// Show clickable skill pill in header
					if (!skill?.name) {
						return {content: renderHeader(state, Sparkles, i18n("No skills found")), isCustom: false };
					}

					// Create a full Skill object from the result details
					const fullSkill: Skill = {
						name: skill.name,
						domainPatterns: skill.domainPatterns || [],
						shortDescription: skill.shortDescription || "",
						description: skill.description || "",
						examples: skill.examples || "",
						library: skill.library || "",
						createdAt: "",
						lastUpdated: "",
					};

					const statusIcon = html`<span class="inline-block text-green-600 dark:text-green-500">${icon(Sparkles, "sm")}</span>`;

					return {content: html`
						<div class="flex items-center gap-2 text-sm text-muted-foreground">
							${statusIcon}
							<span>${i18n("Got skill")}</span>
							${SkillPill(fullSkill, true)}
						</div>
					`, isCustom: false };
				}

				case "list": {
					// Show "Skills for <domain>" header + skill pills
					const skills = skill?.skills || [];
					if (skills.length === 0) {
						return {content: renderHeader(state, Sparkles, i18n("No skills found")), isCustom: false };
					}

					// Get domain from first skill
					const domain = skills[0]?.domainPatterns?.[0] || "";
					const statusIcon = html`<span class="inline-block text-green-600 dark:text-green-500">${icon(Sparkles, "sm")}</span>`;

					return {content: html`
						<div class="space-y-3">
							<div class="flex items-center gap-2 text-sm text-muted-foreground">
								${statusIcon}
								<span>${i18n("Skills for domain")}</span>
								${domain ? DomainPill(domain) : ""}
							</div>
							<div class="flex flex-wrap gap-2">
								${skills.map((s) => SkillPill(s, true))}
							</div>
						</div>
					`, isCustom: false};
				}

				case "create":
				case "update": {
					// Show all skill fields (including library)
					// Skill data comes from result.details (full Skill object)
					const skillData = skill || params.data || {};
					const skillName = skillData.name;
					if (!skillName) {
						return {content: renderHeader(state, Sparkles, i18n("Processing skill...")), isCustom: false };
					}

					const headerText =
						action === "create"
							? state === "complete"
								? i18n("Created skill")
								: i18n("Creating skill")
							: state === "complete"
								? i18n("Updated skill")
								: i18n("Updating skill");

					return {content: html`
						<div class="space-y-3">
							${renderHeader(state, Sparkles, headerText)}
							${renderSkillFields(skillData, true)}
						</div>
					`, isCustom: false};
				}

				case "delete": {
					// Show "Deleted skill" with pill in header row
					const skillName = params.name;
					const statusIcon = html`<span class="inline-block text-green-600 dark:text-green-500">${icon(Sparkles, "sm")}</span>`;
					return {content: html`
						<div class="flex items-center gap-2 text-sm text-muted-foreground">
							${statusIcon}
							<span>${i18n("Deleted skill")}</span>
							${skillName ? SkillPill(skillName) : ""}
						</div>
					`, isCustom: false};
				}

				default:
					return {content: renderHeader(state, Sparkles, result.output || ""), isCustom: false};
			}
		}

		// Params only (streaming)
		if (params) {
			const { action, name, data } = params;

			switch (action) {
				case "create":
				case "update": {
					// Show streaming skill fields as they come in
					const skillName = data?.name || name;
					if (!skillName) {
						const labels: Record<string, string> = {
							create: i18n("Creating skill"),
							update: i18n("Updating skill"),
						};
						return {content: renderHeader(state, Sparkles, labels[action] || ""), isCustom: false  };
					}

					const labels: Record<string, string> = {
						create: i18n("Creating skill"),
						update: i18n("Updating skill"),
					};
					const headerText = `${labels[action]} ${skillName}`;

					return {content: html`
						<div class="space-y-3">
							${renderHeader(state, Sparkles, headerText)}
							${data ? renderSkillFields(data, true) : ""}
						</div>
					`, isCustom: false};
				}
				default: {
					const skillName = name || data?.name;
					const labels: Record<string, string> = {
						get: i18n("Getting skill"),
						list: i18n("Listing skills"),
						delete: i18n("Deleting skill"),
					};
					const headerText = skillName
						? `${labels[action] || action} ${skillName}`
						: labels[action] || action || "";
					return {content: renderHeader(state, Sparkles, headerText), isCustom: false};
				}
			}
		}

		// No params, no result
		return {content: renderHeader(state, Sparkles, i18n("Processing skill...")), isCustom: false};
	},
};

registerToolRenderer(skillTool.name, skillRenderer);
