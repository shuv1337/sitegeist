import { Button } from "@mariozechner/mini-lit";
import type { ToolCall, ToolResultMessage as ToolResultMessageType } from "@mariozechner/pi-ai";
import { ArtifactsToolRenderer, BashRenderer, CalculateRenderer, GetCurrentTimeRenderer, ToolMessage, getToolRenderer, javascriptReplTool, registerToolRenderer } from "@mariozechner/pi-web-ui";
import { html, LitElement } from "lit";
import { customElement, state } from "lit/decorators.js";

import "./tools/browser-javascript.js";
import "./tools/skill.js";

// Register built-in pi-web-ui renderers for demo
registerToolRenderer("bash", new BashRenderer());
registerToolRenderer("calculate", new CalculateRenderer());
registerToolRenderer("get_current_time", new GetCurrentTimeRenderer());
registerToolRenderer("artifacts", new ArtifactsToolRenderer());

interface ToolTestCase {
	name: string;
	label: string;
	// biome-ignore lint/suspicious/noExplicitAny: fine
	params: any;
	result?: ToolResultMessageType;
	isStreaming?: boolean;
	pending?: boolean;
	isError?: boolean;
}

@customElement("tool-renderer-viewer")
class ToolRendererViewer extends LitElement {
	@state() private selectedTool = "skill";
	@state() private selectedState = "params-only";

	protected createRenderRoot() {
		return this;
	}

	private getTestCases(): Record<string, ToolTestCase[]> {
		return {
			skill: [
				// CREATE action
				{
					name: "create-no-params",
					label: "Create: No params, no result",
					params: undefined,
				},
				{
					name: "create-partial-params",
					label: "Create: Partial params (action only), no result",
					params: {
						action: "create",
					},
				},
				{
					name: "create-full-params",
					label: "Create: Full params, no result",
					isStreaming: true,
					params: {
						action: "create",
						data: {
							name: "youtube-essentials",
							domainPatterns: ["youtube.com", "youtu.be"],
							shortDescription: "YouTube video player control and transcript extraction",
							description: "Control video playback and extract transcripts",
							examples: "yt.pause()\\nyt.getTranscript()",
							library: "window.yt = { pause: () => {}, getTranscript: () => {} }",
						},
					},
				},
				{
					name: "create-full-result",
					label: "Create: Full params + result",
					params: {
						action: "create",
						data: {
							name: "youtube-essentials",
							domainPatterns: ["youtube.com", "youtu.be"],
							shortDescription: "YouTube video player control and transcript extraction",
							description: "Control video playback and extract transcripts",
							examples: "yt.pause()\\nyt.getTranscript()",
							library: "window.yt = { pause: () => {}, getTranscript: () => {} }",
						},
					},
					result: {
						role: "toolResult",
						toolCallId: "test-create-youtube-essentials",
						toolName: "skill",
						output: "Skill 'youtube-essentials' created.",
						isError: false,
						details: {
							name: "youtube-essentials",
							domainPatterns: ["youtube.com", "youtu.be"],
							shortDescription: "YouTube video player control and transcript extraction",
							description: "Control video playback and extract transcripts. Use `yt.pause()` to pause the current video, and `yt.getTranscript()` to extract the full transcript text.",
							examples: "yt.pause()\\nyt.getTranscript()",
							library: "window.yt = { pause: () => {}, getTranscript: () => {} }",
							createdAt: "2025-10-07T12:00:00Z",
							lastUpdated: "2025-10-07T12:00:00Z",
						},
					},
				},
				{
					name: "create-error",
					label: "Create: Error",
					params: {
						action: "create",
						data: {
							name: "bad-skill",
							domainPatterns: ["example.com"],
							shortDescription: "Test",
							description: "Test",
							examples: "test()",
							library: "window.test = {",
						},
					},
					result: {
						role: "toolResult",
						toolCallId: "test-create-bad-skill",
						toolName: "skill",
						output: "Syntax error in library: Unexpected end of input",
						isError: true,
						details: {},
					},
				},

				// UPDATE action
				{
					name: "update-no-params",
					label: "Update: No params, no result",
					params: undefined,
				},
				{
					name: "update-partial-params",
					label: "Update: Partial params (action only), no result",
					params: {
						action: "update",
					},
				},
				{
					name: "update-full-params",
					label: "Update: Full params, no result",
					isStreaming: true,
					params: {
						action: "update",
						name: "youtube-essentials",
						data: {
							description: "Updated description for YouTube controls",
							library: "window.yt = { pause: () => {}, play: () => {}, getTranscript: () => {} }",
						},
					},
				},
				{
					name: "update-full-result",
					label: "Update: Full params + result",
					params: {
						action: "update",
						name: "youtube-essentials",
						data: {
							description: "Updated description for YouTube controls",
							library: "window.yt = { pause: () => {}, play: () => {}, getTranscript: () => {} }",
						},
					},
					result: {
						role: "toolResult",
						toolCallId: "test-update-youtube-essentials",
						toolName: "skill",
						output: "Skill 'youtube-essentials' updated.",
						isError: false,
						details: {
							name: "youtube-essentials",
							domainPatterns: ["youtube.com", "youtu.be"],
							shortDescription: "YouTube video player control and transcript extraction",
							description: "Updated description for YouTube controls",
							examples: "yt.pause()\\nyt.getTranscript()",
							library: "window.yt = { pause: () => {}, play: () => {}, getTranscript: () => {} }",
							createdAt: "2025-10-07T12:00:00Z",
							lastUpdated: "2025-10-07T13:00:00Z",
						},
					},
				},

				// GET action
				{
					name: "get-no-params",
					label: "Get: No params, no result",
					params: undefined,
				},
				{
					name: "get-partial-params",
					label: "Get: Partial params (action only), no result",
					params: {
						action: "get",
					},
				},
				{
					name: "get-full-params",
					label: "Get: Full params, no result",
					isStreaming: true,
					params: {
						action: "get",
						name: "youtube-essentials",
					},
				},
				{
					name: "get-full-result",
					label: "Get: Full params + result",
					params: {
						action: "get",
						name: "youtube-essentials",
					},
					result: {
						role: "toolResult",
						toolCallId: "test-get-youtube-essentials",
						toolName: "skill",
						output: "youtube-essentials (youtube.com, youtu.be)\\nControl video playback and extract transcripts\\n\\nExamples:\\nyt.pause()\\nyt.getTranscript()",
						isError: false,
						details: {
							name: "youtube-essentials",
							domainPatterns: ["youtube.com", "youtu.be"],
							shortDescription: "YouTube video player control and transcript extraction",
							description: "Control video playback and extract transcripts. Use `yt.pause()` to pause the current video, and `yt.getTranscript()` to extract the full transcript text.",
							examples: "yt.pause()\\nyt.getTranscript()",
							library: "window.yt = { pause: () => {}, getTranscript: () => {} }",
							createdAt: "2025-10-07T12:00:00Z",
							lastUpdated: "2025-10-07T12:00:00Z",
						},
					},
				},

				// LIST action
				{
					name: "list-no-params",
					label: "List: No params, no result",
					params: undefined,
				},
				{
					name: "list-partial-params",
					label: "List: Partial params (action only), no result",
					params: {
						action: "list",
					},
				},
				{
					name: "list-full-params",
					label: "List: Full params, no result",
					isStreaming: true,
					params: {
						action: "list",
					},
				},
				{
					name: "list-full-result",
					label: "List: Full params + result",
					params: {
						action: "list",
					},
					result: {
						role: "toolResult",
						toolCallId: "test-list-skills",
						toolName: "skill",
						output: "youtube-essentials: YouTube controls\\ngithub-helper: GitHub automation",
						isError: false,
						details: {
							skills: [
								{ domainPatterns: ["youtube.com", "youtu.be"], name: "youtube-essentials" },
								{ domainPatterns: ["github.com"], name: "github-helper" },
							],
						},
					},
				},

				// DELETE action
				{
					name: "delete-no-params",
					label: "Delete: No params, no result",
					params: undefined,
				},
				{
					name: "delete-partial-params",
					label: "Delete: Partial params (action only), no result",
					params: {
						action: "delete",
					},
				},
				{
					name: "delete-full-params",
					label: "Delete: Full params, no result",
					isStreaming: true,
					params: {
						action: "delete",
						name: "youtube-essentials",
					},
				},
				{
					name: "delete-full-result",
					label: "Delete: Full params + result",
					params: {
						action: "delete",
						name: "youtube-essentials",
					},
					result: {
						role: "toolResult",
						toolCallId: "test-delete-youtube-essentials",
						toolName: "skill",
						output: "Skill 'youtube-essentials' deleted.",
						isError: false,
						details: {
							name: "youtube-essentials",
						},
					},
				},
			],
			browser_javascript: [
				{
					name: "execute-streaming",
					label: "Execute (Streaming)",
					isStreaming: true,
					params: {
						code: "",
						title: "Get page title",
					},
				},
				{
					name: "execute-complete",
					label: "Execute (Complete)",
					params: {
						code: "return document.ti",
						title: "Get page title",
					},
				},
				{
					name: "execute-complete",
					label: "Execute (Complete)",
					params: {
						code: "return document.title;",
						title: "Get page title",
					},
					result: {
						role: "toolResult",
						toolCallId: "test-execute-get-title",
						toolName: "browser_javascript",
						output: "YouTube",
						isError: false,
						details: {},
					},
				},
				{
					name: "execute-error",
					label: "Execute (Error)",
					params: {
						code: "throw new Error('Test error');",
						title: "Error test",
					},
					result: {
						role: "toolResult",
						toolCallId: "test-execute-get-title",
						toolName: "browser_javascript",
						output: "Error: Test error",
						isError: true,
						details: {},
					},
				},
			],
			javascript_repl: [
				{
					name: "execute-streaming",
					label: "Execute (Streaming)",
					isStreaming: true,
					params: {}
				},
				{
					name: "execute-streaming",
					label: "Execute (Streaming)",
					isStreaming: true,
					params: {
						code: "console.log('Calculating",
					},
				},
				{
					name: "execute-complete",
					label: "Execute (Complete)",
					params: {
						code: "console.log('Hello from REPL!');",
					},
					result: {
						role: "toolResult",
						toolCallId: "test-execute-repl-hello",
						toolName: "javascript_repl",
						output: "Hello from REPL!",
						isError: false,
						details: {},
					},
				},
				{
					name: "execute-with-files",
					label: "Execute (With Files)",
					params: {
						code: "await returnFile('data.txt', 'Sample data', 'text/plain');",
					},
					result: {
						role: "toolResult",
						toolCallId: "test-execute-repl-files",
						toolName: "javascript_repl",
						output: "[Files returned: 1]\n  - data.txt (text/plain)",
						isError: false,
						details: {
							files: [
								{
									fileName: "data.txt",
									mimeType: "text/plain",
									size: 11,
									contentBase64: btoa("Sample data"),
								},
							],
						},
					},
				},
				{
					name: "execute-error",
					label: "Execute (Error)",
					params: {
						code: "throw new Error('Division by zero');",
					},
					result: {
						role: "toolResult",
						toolCallId: "test-execute-repl-error",
						toolName: "javascript_repl",
						output: "Error: Division by zero",
						isError: true,
						details: {},
					},
				},
			],
			bash: [
				{
					name: "running",
					label: "Running",
					isStreaming: false,
					params: {
					},
				},
				{
					name: "running",
					label: "Running",
					isStreaming: true,
					params: {
					},
				},
				{
					name: "running",
					label: "Running",
					isStreaming: false,
					params: {
						command: "ls -la",
					},
				},
				{
					name: "complete",
					label: "Complete",
					params: {
						command: "echo 'Hello World'",
					},
					result: {
						role: "toolResult",
						toolCallId: "test-bash-complete",
						toolName: "bash",
						output: "Hello World",
						isError: false,
						details: {},
					},
				},
				{
					name: "complete",
					label: "Error",
					params: {
						command: "echo 'Hello World'",
					},
					result: {
						role: "toolResult",
						toolCallId: "test-bash-complete",
						toolName: "bash",
						output: "Hello Error",
						isError: true,
						details: {},
					},
				},
			],
			calculate: [
				{
					name: "no-params",
					label: "No params, no result",
					params: undefined,
				},
				{
					name: "partial-params",
					label: "Partial params (empty expression), no result",
					params: {
						expression: "",
					},
				},
				{
					name: "full-params",
					label: "Full params, no result",
					params: {
						expression: "2 + 2 * 10",
					},
				},
				{
					name: "complete",
					label: "Full params + result",
					params: {
						expression: "2 + 2 * 10",
					},
					result: {
						role: "toolResult",
						toolCallId: "test-calculate",
						toolName: "calculate",
						output: "22",
						isError: false,
						details: {},
					},
				},
				{
					name: "error",
					label: "Full params + error",
					params: {
						expression: "1 / 0",
					},
					result: {
						role: "toolResult",
						toolCallId: "test-calculate-error",
						toolName: "calculate",
						output: "Division by zero",
						isError: true,
						details: {},
					},
				},
			],
			get_current_time: [
				{
					name: "no-params",
					label: "No params, no result",
					params: undefined,
				},
				{
					name: "partial-params",
					label: "Partial params (no timezone), no result",
					params: {},
				},
				{
					name: "full-params",
					label: "Full params (with timezone), no result",
					params: {
						timezone: "America/New_York",
					},
				},
				{
					name: "complete-no-timezone",
					label: "No params + result",
					params: {},
					result: {
						role: "toolResult",
						toolCallId: "test-time",
						toolName: "get_current_time",
						output: "2025-10-07T20:30:00Z",
						isError: false,
						details: {},
					},
				},
				{
					name: "complete-with-timezone",
					label: "Full params (with timezone) + result",
					params: {
						timezone: "America/New_York",
					},
					result: {
						role: "toolResult",
						toolCallId: "test-time-tz",
						toolName: "get_current_time",
						output: "2025-10-07T16:30:00-04:00",
						isError: false,
						details: {},
					},
				},
				{
					name: "error",
					label: "Full params + error",
					params: {
						timezone: "Invalid/Timezone",
					},
					result: {
						role: "toolResult",
						toolCallId: "test-time-error",
						toolName: "get_current_time",
						output: "Invalid timezone",
						isError: true,
						details: {},
					},
				},
			],
			artifacts: [
				// No params, no result
				{
					name: "no-params",
					label: "No params, no result",
					params: undefined,
				},

				// CREATE command
				{
					name: "create-no-params",
					label: "Create: No params (preparing)",
					isStreaming: true,
					params: undefined,
				},
				{
					name: "create-partial-params",
					label: "Create: Partial params (command only), no result",
					isStreaming: true,
					params: {
						command: "create",
						filename: "",
					},
				},
				{
					name: "create-streaming-filename",
					label: "Create: Streaming filename, no content yet",
					isStreaming: true,
					params: {
						command: "create",
						filename: "index.html",
					},
				},
				{
					name: "create-full-params",
					label: "Create: Full params (with content), no result",
					isStreaming: true,
					params: {
						command: "create",
						filename: "index.html",
						content: '<!DOCTYPE html>\\n<html>\\n<head>\\n  <title>Hello World</title>\\n</head>\\n<body>\\n  <h1>Hello, World!</h1>\\n</body>\\n</html>',
					},
				},
				{
					name: "create-complete",
					label: "Create: Full params + result",
					params: {
						command: "create",
						filename: "index.html",
						content: '<!DOCTYPE html>\\n<html>\\n<head>\\n  <title>Hello World</title>\\n</head>\\n<body>\\n  <h1>Hello, World!</h1>\\n</body>\\n</html>',
					},
					result: {
						role: "toolResult",
						toolCallId: "test-create-artifact",
						toolName: "artifacts",
						output: "Created index.html",
						isError: false,
						details: undefined,
					},
				},
				{
					name: "create-error",
					label: "Create: Error",
					params: {
						command: "create",
						filename: "index.html",
						content: '<!DOCTYPE html>\\n<html>',
					},
					result: {
						role: "toolResult",
						toolCallId: "test-create-artifact-error",
						toolName: "artifacts",
						output: "Error: Failed to create artifact",
						isError: true,
						details: undefined,
					},
				},

				// UPDATE command
				{
					name: "update-partial-params",
					label: "Update: Partial params (command + filename), no result",
					isStreaming: true,
					params: {
						command: "update",
						filename: "index.html",
					},
				},
				{
					name: "update-full-params",
					label: "Update: Full params (with old_str and new_str), no result",
					isStreaming: true,
					params: {
						command: "update",
						filename: "index.html",
						old_str: "<h1>Hello, World!</h1>",
						new_str: "<h1>Hello, Universe!</h1>",
					},
				},
				{
					name: "update-complete",
					label: "Update: Full params + result",
					params: {
						command: "update",
						filename: "index.html",
						old_str: "<h1>Hello, World!</h1>",
						new_str: "<h1>Hello, Universe!</h1>",
					},
					result: {
						role: "toolResult",
						toolCallId: "test-update-artifact",
						toolName: "artifacts",
						output: "Updated index.html",
						isError: false,
						details: undefined,
					},
				},
				{
					name: "update-error",
					label: "Update: Error (string not found)",
					params: {
						command: "update",
						filename: "index.html",
						old_str: "<h1>Not Found</h1>",
						new_str: "<h1>New Content</h1>",
					},
					result: {
						role: "toolResult",
						toolCallId: "test-update-artifact-error",
						toolName: "artifacts",
						output: "Error: String not found in file",
						isError: true,
						details: undefined,
					},
				},

				// REWRITE command
				{
					name: "rewrite-partial-params",
					label: "Rewrite: Partial params (command + filename), no result",
					isStreaming: true,
					params: {
						command: "rewrite",
						filename: "script.js",
					},
				},
				{
					name: "rewrite-full-params",
					label: "Rewrite: Full params (with content), no result",
					isStreaming: true,
					params: {
						command: "rewrite",
						filename: "script.js",
						content: "// Complete rewrite\\nconsole.log('New implementation');\\n\\nfunction main() {\\n  console.log('Hello!');\\n}\\n\\nmain();",
					},
				},
				{
					name: "rewrite-complete",
					label: "Rewrite: Full params + result",
					params: {
						command: "rewrite",
						filename: "script.js",
						content: "// Complete rewrite\\nconsole.log('New implementation');\\n\\nfunction main() {\\n  console.log('Hello!');\\n}\\n\\nmain();",
					},
					result: {
						role: "toolResult",
						toolCallId: "test-rewrite-artifact",
						toolName: "artifacts",
						output: "Rewrote script.js",
						isError: false,
						details: undefined,
					},
				},

				// GET command
				{
					name: "get-partial-params",
					label: "Get: Partial params (command + filename), no result",
					params: {
						command: "get",
						filename: "index.html",
					},
				},
				{
					name: "get-complete",
					label: "Get: Full params + result",
					params: {
						command: "get",
						filename: "index.html",
					},
					result: {
						role: "toolResult",
						toolCallId: "test-get-artifact",
						toolName: "artifacts",
						output: '<!DOCTYPE html>\\n<html>\\n<head>\\n  <title>Hello World</title>\\n</head>\\n<body>\\n  <h1>Hello, Universe!</h1>\\n</body>\\n</html>',
						isError: false,
						details: undefined,
					},
				},
				{
					name: "get-error",
					label: "Get: Error (file not found)",
					params: {
						command: "get",
						filename: "nonexistent.html",
					},
					result: {
						role: "toolResult",
						toolCallId: "test-get-artifact-error",
						toolName: "artifacts",
						output: "Error: File not found",
						isError: true,
						details: undefined,
					},
				},

				// DELETE command
				{
					name: "delete-partial-params",
					label: "Delete: Partial params (command + filename), no result",
					params: {
						command: "delete",
						filename: "old-file.html",
					},
				},
				{
					name: "delete-complete",
					label: "Delete: Full params + result",
					params: {
						command: "delete",
						filename: "old-file.html",
					},
					result: {
						role: "toolResult",
						toolCallId: "test-delete-artifact",
						toolName: "artifacts",
						output: "Deleted old-file.html",
						isError: false,
						details: undefined,
					},
				},
				{
					name: "delete-error",
					label: "Delete: Error (file not found)",
					params: {
						command: "delete",
						filename: "nonexistent.html",
					},
					result: {
						role: "toolResult",
						toolCallId: "test-delete-artifact-error",
						toolName: "artifacts",
						output: "Error: File not found",
						isError: true,
						details: undefined,
					},
				},

				// LOGS command
				{
					name: "logs-partial-params",
					label: "Logs: Partial params (command + filename), no result",
					params: {
						command: "logs",
						filename: "index.html",
					},
				},
				{
					name: "logs-complete",
					label: "Logs: Full params + result",
					params: {
						command: "logs",
						filename: "index.html",
					},
					result: {
						role: "toolResult",
						toolCallId: "test-logs-artifact",
						toolName: "artifacts",
						output: "[2025-10-08 10:30:15] INFO: Artifact loaded\\n[2025-10-08 10:30:16] INFO: DOM ready\\n[2025-10-08 10:30:17] LOG: Hello, Universe!",
						isError: false,
						details: undefined,
					},
				},
				{
					name: "logs-no-logs",
					label: "Logs: No logs available",
					params: {
						command: "logs",
						filename: "script.js",
					},
					result: {
						role: "toolResult",
						toolCallId: "test-logs-no-output",
						toolName: "artifacts",
						output: "No logs for script.js",
						isError: false,
						details: undefined,
					},
				},
			],
		};
	}

	private renderToolExample(toolName: string, testCase: ToolTestCase) {
		const toolCall: ToolCall = {
			type: "toolCall",
			id: `test-${testCase.name}`,
			name: toolName,
			arguments: testCase.params,
		};

		const tool = {
			name: toolName,
			label: testCase.label,
		};

		return html`
			<div class="mb-6">
				<h3 class="text-sm font-semibold mb-2 text-foreground">${testCase.label}</h3>
				<tool-message
					.toolCall=${toolCall}
					.tool=${tool}
					.result=${testCase.result}
					.pending=${testCase.pending || false}
					.isStreaming=${testCase.isStreaming || false}
				></tool-message>
			</div>
		`;
	}

	override render() {
		const testCases = this.getTestCases();
		const tools = Object.keys(testCases);
		const currentCases = testCases[this.selectedTool] || [];

		return html`
			<div class="min-h-screen bg-background">
				<!-- Header -->
				<div class="border-b border-border bg-card">
					<div class="max-w-7xl mx-auto px-6 py-4">
						<div class="flex items-center justify-between">
							<div>
								<h1 class="text-2xl font-bold text-foreground">Tool Renderer Viewer</h1>
								<p class="text-sm text-muted-foreground mt-1">
									Test and compare tool renderer designs
								</p>
							</div>
							<div class="flex gap-2">
								<theme-toggle></theme-toggle>
							</div>
						</div>
					</div>
				</div>

				<div class="max-w-7xl mx-auto px-6 py-6">
					<div class="grid grid-cols-12 gap-6">
						<!-- Sidebar -->
						<div class="col-span-3">
							<div class="sticky top-6 space-y-4">
								<div>
									<h2 class="text-sm font-semibold mb-2 text-foreground">Tool</h2>
									<div class="space-y-1">
										${tools.map(
											(tool) => html`
												<button
													class="w-full text-left px-3 py-2 text-sm rounded-md transition-colors ${this
														.selectedTool === tool
														? "bg-secondary text-foreground font-medium"
														: "text-muted-foreground hover:bg-secondary/50"}"
													@click=${() => {this.selectedTool = tool}}
												>
													${tool}
												</button>
											`
										)}
									</div>
								</div>

								<div>
									<h2 class="text-sm font-semibold mb-2 text-foreground">Documentation</h2>
									<a
										href="docs/tool-renderers.md"
										target="_blank"
										class="text-sm text-primary hover:underline"
									>
										Tool Renderer Spec →
									</a>
								</div>
							</div>
						</div>

						<!-- Content -->
						<div class="col-span-9">
							<div class="space-y-6">
								<div>
									<h2 class="text-lg font-semibold mb-4 text-foreground">
										${this.selectedTool} Examples
									</h2>
									${currentCases.map((testCase) =>
										this.renderToolExample(this.selectedTool, testCase)
									)}
								</div>
							</div>
						</div>
					</div>
				</div>
			</div>
		`;
	}
}

// Initialize the app
const app = document.getElementById("app");
if (app) {
	const viewer = new ToolRendererViewer();
	app.appendChild(viewer);
}
