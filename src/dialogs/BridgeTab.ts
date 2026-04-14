import { SettingsTab } from "@mariozechner/pi-web-ui";
import { html, type TemplateResult } from "lit";
import { customElement, state } from "lit/decorators.js";
import type { BridgeConnectionState } from "../bridge/extension-client.js";
import {
	BRIDGE_SETTINGS_KEY,
	BRIDGE_STATE_KEY,
	type BridgeSettings,
	type BridgeStateData,
} from "../bridge/internal-messages.js";
import { getDefaultBridgeSettings, isLoopbackBridgeUrl, normalizeBridgeSettings } from "../bridge/settings.js";

@customElement("bridge-tab")
export class BridgeTab extends SettingsTab {
	@state() private enabled = true;
	@state() private url = getDefaultBridgeSettings().url;
	@state() private token = "";
	@state() private sensitiveAccessEnabled = false;
	@state() private bridgeState: BridgeConnectionState = "disconnected";
	@state() private bridgeDetail: string | undefined;

	private readonly storageChangeListener = (
		changes: Record<string, chrome.storage.StorageChange>,
		areaName: string,
	) => {
		if (areaName === "local" && changes[BRIDGE_SETTINGS_KEY]) {
			this.applySettings(
				normalizeBridgeSettings(changes[BRIDGE_SETTINGS_KEY].newValue as BridgeSettings | undefined),
			);
		}

		if (areaName === "session" && changes[BRIDGE_STATE_KEY]) {
			this.applyBridgeState(changes[BRIDGE_STATE_KEY].newValue as BridgeStateData | undefined);
		}
	};

	getTabName(): string {
		return "Bridge";
	}

	override async connectedCallback() {
		super.connectedCallback();
		await this.loadSettings();
		await this.loadBridgeState();
		chrome.storage.onChanged.addListener(this.storageChangeListener);
	}

	override disconnectedCallback() {
		super.disconnectedCallback();
		chrome.storage.onChanged.removeListener(this.storageChangeListener);
	}

	private applySettings(settings = getDefaultBridgeSettings()) {
		this.enabled = settings.enabled;
		this.url = settings.url;
		this.token = settings.token;
		this.sensitiveAccessEnabled = settings.sensitiveAccessEnabled;
		if (!this.enabled && this.bridgeState !== "disabled") {
			this.bridgeState = "disabled";
			this.bridgeDetail = undefined;
		}
	}

	private applyBridgeState(stateData?: BridgeStateData) {
		if (!stateData) {
			this.bridgeState = this.enabled ? "disconnected" : "disabled";
			this.bridgeDetail = undefined;
			return;
		}
		this.bridgeState = stateData.state;
		this.bridgeDetail = stateData.detail;
	}

	private async loadSettings() {
		const result = await chrome.storage.local.get(BRIDGE_SETTINGS_KEY);
		this.applySettings(normalizeBridgeSettings(result[BRIDGE_SETTINGS_KEY] as BridgeSettings | undefined));
	}

	private async loadBridgeState() {
		const result = await chrome.storage.session.get(BRIDGE_STATE_KEY);
		this.applyBridgeState(result[BRIDGE_STATE_KEY] as BridgeStateData | undefined);
	}

	private async persistSettings() {
		await chrome.storage.local.set({
			[BRIDGE_SETTINGS_KEY]: {
				enabled: this.enabled,
				url: this.url,
				token: this.token,
				sensitiveAccessEnabled: this.sensitiveAccessEnabled,
			},
		});
	}

	private async setBlocked(blocked: boolean) {
		this.enabled = !blocked;
		await this.persistSettings();
	}

	private async commitAdvancedSettings() {
		await this.persistSettings();
	}

	private async setSensitiveAccessEnabled(enabled: boolean) {
		this.sensitiveAccessEnabled = enabled;
		await this.persistSettings();
	}

	private isLoopbackMode(): boolean {
		return isLoopbackBridgeUrl(this.url);
	}

	private stateLabel(): string {
		switch (this.bridgeState) {
			case "disabled":
				return "Blocked";
			case "disconnected":
				return "Disconnected";
			case "connecting":
				return "Connecting...";
			case "connected":
				return "Connected";
			case "error":
				return this.bridgeDetail ? `Error: ${this.bridgeDetail}` : "Error";
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

	private disconnectedHelpText(): string | null {
		if (!this.enabled || this.bridgeState === "connected") return null;
		if (this.isLoopbackMode()) {
			return "Run any `shuvgeist` command or `shuvgeist serve` to start the local bridge.";
		}
		if (!this.token.trim()) {
			return "Enter the remote bridge token to connect to a LAN or remote bridge.";
		}
		return "Check the remote bridge URL and token if the bridge stays disconnected.";
	}

	render(): TemplateResult {
		const blocked = !this.enabled;
		const loopbackMode = this.isLoopbackMode();
		const helpText = this.disconnectedHelpText();
		const advancedOpen = !loopbackMode || this.token.length > 0;

		return html`
			<div class="flex flex-col gap-4">
				<div class="space-y-2">
					<h3 class="text-lg font-semibold text-foreground">CLI Bridge</h3>
					<p class="text-sm text-muted-foreground">
						Monitor the bridge connection, control sensitive access, and optionally override remote bridge settings.
					</p>
				</div>

				<div class="flex items-center justify-between rounded-lg border border-border bg-muted/40 px-3 py-2">
					<span class="text-xs font-medium text-muted-foreground">Status</span>
					<span class="text-xs font-medium ${this.stateColor()}">${this.stateLabel()}</span>
				</div>

				<label class="flex items-center gap-3 cursor-pointer">
					<input
						type="checkbox"
						class="w-4 h-4 rounded border-border accent-primary"
						.checked=${blocked}
						@change=${(e: Event) => this.setBlocked((e.target as HTMLInputElement).checked)}
					/>
					<span class="text-sm font-medium text-foreground">Block bridge connections</span>
				</label>

				<div class="p-3 rounded-lg bg-red-500/10 border border-red-500/30 space-y-3">
					<div class="space-y-1">
						<div class="text-sm font-medium text-foreground">Sensitive browser data access</div>
						<p class="text-xs text-muted-foreground">
							Allows bridge commands that access sensitive browser state, including
							<code class="text-foreground">shuvgeist eval</code> and
							<code class="text-foreground">shuvgeist cookies</code>.
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

				<details class="rounded-lg border border-border bg-muted/30 p-3" ?open=${advancedOpen}>
					<summary class="cursor-pointer text-sm font-medium text-foreground">Advanced: Remote bridge settings</summary>
					<div class="mt-3 space-y-3">
						<p class="text-xs text-muted-foreground">
							These fields are only needed for LAN or remote bridges, or when manually overriding the local default.
						</p>
						<div class="space-y-1">
							<label class="text-xs font-medium text-muted-foreground">Bridge server URL</label>
							<input
								type="text"
								class="w-full px-3 py-2 text-sm rounded-md border border-border bg-background text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
								placeholder="ws://127.0.0.1:19285/ws"
								.value=${this.url}
								@input=${(e: Event) => {
									this.url = (e.target as HTMLInputElement).value;
								}}
								@blur=${() => this.commitAdvancedSettings()}
								@keydown=${(e: KeyboardEvent) => {
									if (e.key === "Enter") this.commitAdvancedSettings();
								}}
							/>
						</div>
						<div class="space-y-1">
							<label class="text-xs font-medium text-muted-foreground">Token</label>
							<input
								type="password"
								class="w-full px-3 py-2 text-sm rounded-md border border-border bg-background text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
								placeholder="Remote bridge token"
								.value=${this.token}
								@input=${(e: Event) => {
									this.token = (e.target as HTMLInputElement).value;
								}}
								@blur=${() => this.commitAdvancedSettings()}
								@keydown=${(e: KeyboardEvent) => {
									if (e.key === "Enter") this.commitAdvancedSettings();
								}}
							/>
						</div>
					</div>
				</details>

				${
					helpText
						? html`
						<div class="p-3 rounded-lg bg-muted/50 border border-border space-y-2">
							<p class="text-xs text-muted-foreground">${helpText}</p>
							${
								loopbackMode
									? html`<p class="text-xs text-muted-foreground">
									Same-host mode uses <code class="text-foreground">ws://127.0.0.1:19285/ws</code> and bootstraps the token automatically.
								</p>`
									: html`<p class="text-xs text-muted-foreground">
									Remote bridges still require a manually provided token.
								</p>`
							}
						</div>
					`
						: null
				}

				<div class="p-3 rounded-lg bg-yellow-500/10 border border-yellow-500/30">
					<p class="text-xs text-yellow-300">
						Bridge traffic is unencrypted. Use remote or LAN bridges only on a trusted local network.
					</p>
				</div>
			</div>
		`;
	}
}
