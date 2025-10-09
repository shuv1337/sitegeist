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
					const validation = await validateJavaScriptSyntax(args.data.library);
					if (!validation.valid) {
						return {
							output: `Syntax error in library: ${validation.error}`,
							isError: true,
							details: {},
						};
					}

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
	): TemplateResult {
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
				return html`
					<div class="space-y-3">
						${renderHeader(state, Sparkles, headerText)}
						${renderSkillFields(params.data, true)}
						<div class="w-full px-3 py-2 text-sm text-destructive bg-destructive/10 border border-destructive rounded">
							${result.output || ""}
						</div>
					</div>
				`;
			}

			return html`
				<div class="space-y-3">
					${renderHeader(state, Sparkles, headerText)}
					<div class="text-sm text-destructive">${result.output || ""}</div>
				</div>
			`;
		}

		// Full params + result
		if (result && params) {
			const { action } = params;
			const skill = result.details;

			switch (action) {
				case "get": {
					// Show clickable skill pill in header
					if (!skill?.name) {
						return renderHeader(state, Sparkles, i18n("No skills found"));
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

					return html`
						<div class="flex items-center gap-2 text-sm text-muted-foreground">
							${statusIcon}
							<span>${i18n("Got skill")}</span>
							${SkillPill(fullSkill, true)}
						</div>
					`;
				}

				case "list": {
					// Show "Skills for <domain>" header + skill pills
					const skills = skill?.skills || [];
					if (skills.length === 0) {
						return renderHeader(state, Sparkles, i18n("No skills found"));
					}

					// Get domain from first skill
					const domain = skills[0]?.domainPatterns?.[0] || "";
					const statusIcon = html`<span class="inline-block text-green-600 dark:text-green-500">${icon(Sparkles, "sm")}</span>`;

					return html`
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
					`;
				}

				case "create":
				case "update": {
					// Show all skill fields (including library)
					// Skill data comes from result.details (full Skill object)
					const skillData = skill || params.data || {};
					const skillName = skillData.name;
					if (!skillName) {
						return renderHeader(state, Sparkles, i18n("Processing skill..."));
					}

					const headerText =
						action === "create"
							? state === "complete"
								? i18n("Created skill")
								: i18n("Creating skill")
							: state === "complete"
								? i18n("Updated skill")
								: i18n("Updating skill");

					return html`
						<div class="space-y-3">
							${renderHeader(state, Sparkles, headerText)}
							${renderSkillFields(skillData, true)}
						</div>
					`;
				}

				case "delete": {
					// Show "Deleted skill" with pill in header row
					const skillName = params.name;
					const statusIcon = html`<span class="inline-block text-green-600 dark:text-green-500">${icon(Sparkles, "sm")}</span>`;
					return html`
						<div class="flex items-center gap-2 text-sm text-muted-foreground">
							${statusIcon}
							<span>${i18n("Deleted skill")}</span>
							${skillName ? SkillPill(skillName) : ""}
						</div>
					`;
				}

				default:
					return renderHeader(state, Sparkles, result.output || "");
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
						return renderHeader(state, Sparkles, labels[action] || "");
					}

					const labels: Record<string, string> = {
						create: i18n("Creating skill"),
						update: i18n("Updating skill"),
					};
					const headerText = `${labels[action]} ${skillName}`;

					return html`
						<div class="space-y-3">
							${renderHeader(state, Sparkles, headerText)}
							${data ? renderSkillFields(data, true) : ""}
						</div>
					`;
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
					return renderHeader(state, Sparkles, headerText);
				}
			}
		}

		// No params, no result
		return renderHeader(state, Sparkles, i18n("Processing skill..."));
	},
};

registerToolRenderer(skillTool.name, skillRenderer);
