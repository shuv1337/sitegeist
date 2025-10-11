import { Button, icon } from "@mariozechner/mini-lit";
import { getModel } from "@mariozechner/pi-ai";
import { html, render } from "lit";
import { ArrowLeft, Play } from "lucide";
import "./debug/ReplPanel.js";


interface TestPrompt {
	name: string;
	steps: string[];
}

const models = [
	getModel("anthropic", "claude-sonnet-4-5-20250929"),
	getModel("openai", "gpt-5-codex"),
	getModel("google", "gemini-2.5-pro"),
	getModel("openrouter", "z-ai/glm-4.6")
]

const TEST_PROMPTS: TestPrompt[] = [
	{
		name: "Multi-step calculation",
		steps: ["Calculate the sum of numbers from 1 to 100", "Now multiply that result by 3", "Create a bar chart showing the original sum and the multiplied value"],
	},
	{
		name: "HTML artifact iteration",
		steps: [
			"Create an HTML artifact with a red background and 'Hello World' text",
			"Change the background to blue",
			"Add a button that shows an alert when clicked",
		],
	},
	{
		name: "Data processing multi-step",
		steps: [
			"Generate an array of 20000 random numbers between 1 and 100. Calculate the mean, median, and standard deviation. Create a Chart.js visualization showing the distribution. Use a separate tool call for each step.",
		],
	},
	{
		name: "Data processing single step",
		steps: [
			"Generate an array of 20000 random numbers between 1 and 100. Calculate the mean, median, and standard deviation. Create a Chart.js visualization showing the distribution.",
		],
	},
	{
		name: "Web scraping workflow",
		steps: [
			"Search Google for 'JavaScript tutorials'",
			"Extract the first 3 result titles",
			"Write them to a tutorials.md artifact with proper markdown formatting",
		],
	},
];

const renderDebugPage = () => {
	const debugHtml = html`
		<div class="w-full h-full flex flex-col bg-background text-foreground overflow-hidden">
			<!-- Header -->
			<div class="flex items-center gap-2 px-3 py-2 border-b border-border shrink-0">
				${Button({
					variant: "ghost",
					size: "sm",
					children: icon(ArrowLeft, "sm"),
					onClick: () => {
						window.location.href = "./sidepanel.html";
					},
					title: "Back to chat",
				})}
				<span class="text-sm font-semibold">Debug</span>
			</div>

			<!-- Debug content -->
			<div class="flex-1 overflow-auto p-4">
				<div class="space-y-6">
					<!-- REPL Panel Section -->
					<div>
						<h2 class="text-lg font-semibold mb-3">JavaScript REPL</h2>
						<div class="border border-border rounded-lg overflow-hidden" style="height: 600px;">
							<repl-panel></repl-panel>
						</div>
					</div>

					<!-- Test Prompts Section -->
					<div>
						<h2 class="text-lg font-semibold mb-3">Test Prompts</h2>
						<div class="space-y-3">
							${TEST_PROMPTS.map(
								(test) => html`
									<div class="border border-border rounded-lg bg-card overflow-hidden">
										<div class="p-3 bg-accent/30">
											<div class="font-medium text-sm">${test.name}</div>
										</div>
										<div class="p-3 space-y-2">
											${test.steps.map(
												(step, i) => html`
													<div class="flex gap-2 text-sm text-muted-foreground">
														<span class="text-xs font-mono shrink-0">${i + 1}.</span>
														<span>${step}</span>
													</div>
												`,
											)}
										</div>
										<div class="p-3 pt-0 flex gap-2 flex-wrap">
											${models.map(
														(model) => html`
															${Button({
																variant: "outline",
																size: "sm",
																children: html`<span class="flex items-center gap-1.5"
																	>${icon(Play, "xs")} <span class="text-xs">${model.name}</span></span
																>`,
																onClick: () => {
																	const encodedSteps = encodeURIComponent(JSON.stringify(test.steps));
																	window.location.href = `./sidepanel.html?teststeps=${encodedSteps}&provider=${encodeURIComponent(
																		model.provider,
																	)}&model=${encodeURIComponent(model.id)}`;
																},
																title: `Run with ${model.name}`,
															})}
														`,
													)
												}
										</div>
									</div>
								`,
							)}
						</div>
					</div>
				</div>
			</div>
		</div>
	`;

	render(debugHtml, document.body);
};

// Keyboard shortcut to go back
window.addEventListener("keydown", (e) => {
	if ((e.metaKey || e.ctrlKey) && e.key === "u") {
		e.preventDefault();
		window.location.href = "./sidepanel.html";
	}
});

renderDebugPage();
