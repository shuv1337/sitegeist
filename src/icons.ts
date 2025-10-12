import { html, render } from "lit";
import { ArrowLeft, Download } from "lucide";
import { Button, icon } from "@mariozechner/mini-lit";
import "./components/OrbAnimation.js";

// Cross-browser API compatibility
// @ts-expect-error - browser global exists in Firefox, chrome in Chrome
const browser = globalThis.browser || globalThis.chrome;

interface IconSize {
	size: number;
	name: string;
}

const ICON_SIZES: IconSize[] = [
	{ size: 16, name: "icon-16.png" },
	{ size: 48, name: "icon-48.png" },
	{ size: 128, name: "icon-128.png" },
];

let currentOrbElement: HTMLElement | null = null;

function captureOrbAsImage(size: number): Promise<Blob> {
	return new Promise((resolve, reject) => {
		// Create a temporary container
		const container = document.createElement("div");
		container.style.position = "fixed";
		container.style.left = "-9999px";
		container.style.width = `${size * 2}px`; // Render at 2x for better quality
		container.style.height = `${size * 2}px`;
		document.body.appendChild(container);

		// Create orb animation element
		const orb = document.createElement("orb-animation") as any;
		container.appendChild(orb);

		// Wait for orb to initialize and render a few frames
		setTimeout(() => {
			try {
				// Get the canvas element from the orb
				const canvas = container.querySelector("canvas");
				if (!canvas) {
					throw new Error("Canvas not found in orb animation");
				}

				// Create a new canvas at the target size
				const outputCanvas = document.createElement("canvas");
				outputCanvas.width = size;
				outputCanvas.height = size;
				const ctx = outputCanvas.getContext("2d");

				if (!ctx) {
					throw new Error("Failed to get 2D context");
				}

				// Draw the orb canvas scaled down to target size
				ctx.drawImage(canvas, 0, 0, size, size);

				// Convert to blob
				outputCanvas.toBlob(
					(blob) => {
						// Cleanup
						document.body.removeChild(container);

						if (blob) {
							resolve(blob);
						} else {
							reject(new Error("Failed to create blob from canvas"));
						}
					},
					"image/png",
					1.0,
				);
			} catch (error) {
				document.body.removeChild(container);
				reject(error);
			}
		}, 500); // Wait 500ms for animation to start
	});
}

function downloadBlob(blob: Blob, filename: string) {
	const url = URL.createObjectURL(blob);
	const a = document.createElement("a");
	a.href = url;
	a.download = filename;
	document.body.appendChild(a);
	a.click();
	document.body.removeChild(a);
	URL.revokeObjectURL(url);
}

async function generateIcon(iconSize: IconSize) {
	const statusEl = document.getElementById(`status-${iconSize.size}`);
	const downloadBtn = document.getElementById(`download-${iconSize.size}`);

	if (statusEl) statusEl.textContent = "Generating...";
	if (downloadBtn) (downloadBtn as HTMLButtonElement).disabled = true;

	try {
		const blob = await captureOrbAsImage(iconSize.size);

		if (statusEl) statusEl.textContent = "✓ Ready";
		if (downloadBtn) {
			(downloadBtn as HTMLButtonElement).disabled = false;
			downloadBtn.onclick = () => downloadBlob(blob, iconSize.name);
		}
	} catch (error) {
		console.error(`Failed to generate ${iconSize.name}:`, error);
		if (statusEl) statusEl.textContent = `✗ Error: ${error}`;
		if (downloadBtn) (downloadBtn as HTMLButtonElement).disabled = true;
	}
}

async function generateAllIcons() {
	const generateAllBtn = document.getElementById("generate-all-btn") as HTMLButtonElement;
	if (generateAllBtn) generateAllBtn.disabled = true;

	for (const iconSize of ICON_SIZES) {
		await generateIcon(iconSize);
	}

	if (generateAllBtn) generateAllBtn.disabled = false;
}

function createPreviewOrb() {
	const previewContainer = document.getElementById("orb-preview");
	if (!previewContainer) return;

	// Clear existing orb
	previewContainer.innerHTML = "";

	// Create new orb
	const orb = document.createElement("orb-animation") as any;
	previewContainer.appendChild(orb);
	currentOrbElement = orb;
}

function renderIconsPage() {
	const container = document.getElementById("app");
	if (!container) return;

	const template = html`
		<div class="min-h-screen bg-background text-foreground p-6">
			<!-- Header -->
			<div class="max-w-4xl mx-auto">
				<div class="flex items-center gap-4 mb-8">
					<${Button}
						variant="ghost"
						size="sm"
						@click=${() => (window.location.href = "/debug.html")}
					>
						<span class="flex items-center gap-2">
							${icon(ArrowLeft, "sm")}
							<span>Back to Debug</span>
						</span>
					</${Button}>
					<h1 class="text-3xl font-bold">Icon Generator</h1>
				</div>

				<!-- Instructions -->
				<div class="bg-card border border-border rounded-lg p-6 mb-8">
					<h2 class="text-xl font-semibold mb-3">Instructions</h2>
					<ol class="list-decimal list-inside space-y-2 text-muted-foreground">
						<li>Preview the orb animation below</li>
						<li>Click "Generate All Icons" or generate individual sizes</li>
						<li>Download each icon using the download buttons</li>
						<li>Replace the icon files in the <code class="px-1.5 py-0.5 bg-secondary rounded text-xs">static/</code> directory</li>
					</ol>
				</div>

				<!-- Preview Section -->
				<div class="bg-card border border-border rounded-lg p-6 mb-8">
					<h2 class="text-xl font-semibold mb-4">Preview</h2>
					<div class="flex justify-center">
						<div id="orb-preview" class="relative" style="width: 400px; height: 400px;"></div>
					</div>
				</div>

				<!-- Icon Generation Section -->
				<div class="bg-card border border-border rounded-lg p-6">
					<div class="flex items-center justify-between mb-4">
						<h2 class="text-xl font-semibold">Generate Icons</h2>
						<${Button} id="generate-all-btn" @click=${generateAllIcons}>
							<span class="flex items-center gap-2">
								${icon(Download, "sm")}
								<span>Generate All Icons</span>
							</span>
						</${Button}>
					</div>

					<div class="space-y-4">
						${ICON_SIZES.map(
							(iconSize) => html`
								<div class="flex items-center justify-between p-4 bg-secondary rounded-lg">
									<div class="flex items-center gap-4">
										<div class="w-16 h-16 bg-background rounded border border-border flex items-center justify-center">
											<span class="text-xs text-muted-foreground">${iconSize.size}×${iconSize.size}</span>
										</div>
										<div>
											<div class="font-medium">${iconSize.name}</div>
											<div id="status-${iconSize.size}" class="text-sm text-muted-foreground">Not generated</div>
										</div>
									</div>
									<div class="flex items-center gap-2">
										<${Button}
											size="sm"
											variant="outline"
											@click=${() => generateIcon(iconSize)}
										>
											Generate
										</${Button}>
										<${Button}
											id="download-${iconSize.size}"
											size="sm"
											disabled
										>
											<span class="flex items-center gap-2">
												${icon(Download, "sm")}
												<span>Download</span>
											</span>
										</${Button}>
									</div>
								</div>
							`,
						)}
					</div>
				</div>
			</div>
		</div>
	`;

	render(template, container);

	// Create the preview orb after rendering
	requestAnimationFrame(() => {
		createPreviewOrb();
	});
}

// Initialize
renderIconsPage();
