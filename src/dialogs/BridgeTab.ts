import { getAppStorage, SettingsTab } from "@mariozechner/pi-web-ui";
import { html, type TemplateResult } from "lit";
import { customElement, state } from "lit/decorators.js";
import type { BridgeConnectionState } from "../bridge/extension-client.js";
import { BRIDGE_STATE_KEY, type BridgeStateData } from "../bridge/internal-messages.js";

/**
 * Callback for the BridgeTab to notify the sidepanel when bridge settings
 * change so it can connect/disconnect the BridgeClient.
 */
export type BridgeSettingsChangeCallback = (settings: {
	enabled: boolean;
	url: string;
	token: string;
	sensitiveAccessEnabled: boolean;
}) => void;

let settingsChangeCallback: BridgeSettingsChangeCallback | undefined;

export function setBridgeSettingsChangeCallback(cb: BridgeSettingsChangeCallback): void {
	settingsChangeCallback = cb;
}

export function getBridgeSettingsChangeCallback(): BridgeSettingsChangeCallback | undefined {
	return settingsChangeCallback;
}

@customElement("bridge-tab")
export class BridgeTab extends SettingsTab {
	@state() private enabled = false;
	@state() private url = "";
	@state() private token = "";
	@state() private sensitiveAccessEnabled = false;
	@state() private bridgeState: BridgeConnectionState = "disabled";
	@state() private bridgeDetail: string | undefined;

	private pollInterval: ReturnType<typeof setInterval> | null = null;

	getTabName(): string {
		return "Bridge";
	}

	override async connectedCallback() {
		super.connectedCallback();
		await this.loadSettings();

		// Poll for bridge state changes from background via chrome.storage.session
		this.pollInterval = setInterval(async () => {
			try {
				const result = await chrome.storage.session.get(BRIDGE_STATE_KEY);
				const stateData = result[BRIDGE_STATE_KEY] as BridgeStateData | undefined;
				if (stateData) {
					if (this.bridgeState !== stateData.state || this.bridgeDetail !== stateData.detail) {
						this.bridgeState = stateData.state;
						this.bridgeDetail = stateData.detail;
					}
				}
			} catch {
				// Ignore storage errors
			}
		}, 500);
	}

	override disconnectedCallback() {
		super.disconnectedCallback();
		if (this.pollInterval) {
			clearInterval(this.pollInterval);
			this.pollInterval = null;
		}
	}

	private async loadSettings() {
		const storage = getAppStorage();
		this.enabled = (await storage.settings.get<boolean>("bridge.enabled")) ?? false;
		this.url = (await storage.settings.get<string>("bridge.url")) ?? "ws://127.0.0.1:19285/ws";
		this.token = (await storage.settings.get<string>("bridge.token")) ?? "";
		this.sensitiveAccessEnabled = (await storage.settings.get<boolean>("bridge.sensitiveAccessEnabled")) ?? false;
		// Load initial bridge state from storage
		try {
			const result = await chrome.storage.session.get(BRIDGE_STATE_KEY);
			const stateData = result[BRIDGE_STATE_KEY] as BridgeStateData | undefined;
			if (stateData) {
				this.bridgeState = stateData.state;
				this.bridgeDetail = stateData.detail;
			}
		} catch {
			// Ignore storage errors
		}
	}

	private async setEnabled(enabled: boolean) {
		this.enabled = enabled;
		await getAppStorage().settings.set("bridge.enabled", enabled);
		this.notifyChange();
	}

	private async setUrl(url: string) {
		this.url = url;
		await getAppStorage().settings.set("bridge.url", url);
		// Only notify when enabled — avoids spurious reconnects while editing
	}

	private async setToken(token: string) {
		this.token = token;
		await getAppStorage().settings.set("bridge.token", token);
	}

	private async setSensitiveAccessEnabled(enabled: boolean) {
		this.sensitiveAccessEnabled = enabled;
		await getAppStorage().settings.set("bridge.sensitiveAccessEnabled", enabled);
		this.notifyChange();
	}

	private notifyChange() {
		settingsChangeCallback?.({
			enabled: this.enabled,
			url: this.url,
			token: this.token,
			sensitiveAccessEnabled: this.sensitiveAccessEnabled,
		});
	}

	/** Called when the user finishes editing the URL or token (on blur/enter). */
	private handleFieldCommit() {
		if (this.enabled) {
			this.notifyChange();
		}
	}

	private stateLabel(): string {
		switch (this.bridgeState) {
			case "disabled":
				return "Disabled";
			case "disconnected":
				return "Disconnected";
			case "connecting":
				return "Connecting...";
			case "connected":
				return "Connected";
			case "error":
				return this.bridgeDetail ? "Error: " + this.bridgeDetail : "Error";
		}
	}

	private stateColor(): string {
		switch (this.bridgeState) {
			case "connected":
				return "text-green-400";
			case "connecting":
				return "text-yellow-400";
			case "error":
				return "text-red-400";
			default:
				return "text-muted-foreground";
		}
	}

	render(): TemplateResult {
		return html`
			<div class="flex flex-col gap-4">
				<div class="space-y-2">
					<h3 class="text-lg font-semibold text-foreground">CLI Bridge</h3>
					<p class="text-sm text-muted-foreground">
						Allow external CLI tools to control the browser through this sidepanel.
					</p>
				</div>

				<!-- Enable toggle -->
				<label class="flex items-center gap-3 cursor-pointer">
					<input
						type="checkbox"
						class="w-4 h-4 rounded border-border accent-primary"
						.checked=${this.enabled}
						@change=${(e: Event) => this.setEnabled((e.target as HTMLInputElement).checked)}
					/>
					<span class="text-sm font-medium text-foreground">Enable bridge</span>
				</label>

				<!-- Connection status -->
				<div class="flex items-center gap-2">
					<span class="text-xs font-medium text-muted-foreground">Status:</span>
					<span class="text-xs font-medium ${this.stateColor()}">${this.stateLabel()}</span>
				</div>

				<!-- URL input -->
				<div class="space-y-1">
					<label class="text-xs font-medium text-muted-foreground">Bridge Server URL</label>
					<input
						type="text"
						class="w-full px-3 py-2 text-sm rounded-md border border-border bg-background text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
						placeholder="ws://127.0.0.1:19285/ws"
						.value=${this.url}
						@input=${(e: Event) => this.setUrl((e.target as HTMLInputElement).value)}
						@blur=${() => this.handleFieldCommit()}
						@keydown=${(e: KeyboardEvent) => {
							if (e.key === "Enter") this.handleFieldCommit();
						}}
					/>
				</div>

				<!-- Token input -->
				<div class="space-y-1">
					<label class="text-xs font-medium text-muted-foreground">Token</label>
					<input
						type="password"
						class="w-full px-3 py-2 text-sm rounded-md border border-border bg-background text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
						placeholder="Shared bridge token"
						.value=${this.token}
						@input=${(e: Event) => this.setToken((e.target as HTMLInputElement).value)}
						@blur=${() => this.handleFieldCommit()}
						@keydown=${(e: KeyboardEvent) => {
							if (e.key === "Enter") this.handleFieldCommit();
						}}
					/>
				</div>

				<!-- Sensitive access toggle -->
				<div class="p-3 rounded-lg bg-red-500/10 border border-red-500/30 space-y-3">
					<div class="space-y-1">
						<div class="text-sm font-medium text-foreground">Sensitive browser data access</div>
						<p class="text-xs text-muted-foreground">
							Allows the CLI bridge to use sensitive browser access, including
							<code class="text-foreground">shuvgeist cookies</code> and
							<code class="text-foreground">shuvgeist eval</code>.
						</p>
					</div>
					<label class="flex items-center gap-3 cursor-pointer">
						<input
							type="checkbox"
							class="w-4 h-4 rounded border-border accent-primary"
							.checked=${this.sensitiveAccessEnabled}
							@change=${(e: Event) => this.setSensitiveAccessEnabled((e.target as HTMLInputElement).checked)}
						/>
						<span class="text-sm font-medium text-foreground">Allow sensitive browser data access</span>
					</label>
					<p class="text-xs text-red-200">
						Only enable this when you trust the CLI client and bridge server on this machine or network.
					</p>
				</div>

				<!-- Help text -->
				<div class="p-3 rounded-lg bg-muted/50 border border-border space-y-2">
					<p class="text-xs text-muted-foreground">
						<strong>Same host:</strong> Use <code class="text-foreground">ws://127.0.0.1:19285/ws</code>
					</p>
					<p class="text-xs text-muted-foreground">
						<strong>LAN host:</strong> Use <code class="text-foreground">ws://&lt;bridge-ip&gt;:19285/ws</code>
					</p>
					<p class="text-xs text-muted-foreground">
						Start the bridge server with: <code class="text-foreground">shuvgeist serve</code>
					</p>
				</div>

				<!-- Network warning -->
				<div class="p-3 rounded-lg bg-yellow-500/10 border border-yellow-500/30">
					<p class="text-xs text-yellow-300">
						V1 bridge traffic is unencrypted. Use only on a trusted local network.
					</p>
				</div>
			</div>
		`;
	}
}
