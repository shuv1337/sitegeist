/**
 * Bridge protocol types shared between server, CLI, and extension client.
 *
 * JSON-RPC-inspired messages over WebSocket. The bridge server is the
 * rendezvous point — extension and CLI never connect directly.
 */

// ---------------------------------------------------------------------------
// Capabilities
// ---------------------------------------------------------------------------

export const BridgeCapabilities = [
	"navigate",
	"tabs",
	"repl",
	"screenshot",
	"eval",
	"select_element",
	"status",
	"session_history",
	"session_inject",
	"session_new",
	"session_set_model",
	"session_artifacts",
] as const;
export type BridgeCapability = (typeof BridgeCapabilities)[number];

export function getBridgeCapabilities(debuggerEnabled: boolean): BridgeCapability[] {
	return BridgeCapabilities.filter((capability) => debuggerEnabled || capability !== "eval");
}

export function isWriteMethod(method: BridgeMethod): boolean {
	return method === "session_inject" || method === "session_new" || method === "session_set_model";
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

export interface ExtensionRegistration {
	type: "register";
	role: "extension";
	token: string;
	windowId: number;
	sessionId?: string;
	capabilities: BridgeCapability[];
}

export interface CliRegistration {
	type: "register";
	role: "cli";
	token: string;
	name?: string;
}

export type RegistrationMessage = ExtensionRegistration | CliRegistration;

export interface RegisterResult {
	type: "register_result";
	ok: boolean;
	error?: string;
}

// ---------------------------------------------------------------------------
// Requests / Responses
// ---------------------------------------------------------------------------

export const BridgeMethods = [
	"status",
	"navigate",
	"repl",
	"screenshot",
	"eval",
	"select_element",
	"session_history",
	"session_inject",
	"session_new",
	"session_set_model",
	"session_artifacts",
] as const;
export type BridgeMethod = (typeof BridgeMethods)[number];

export interface BridgeRequest {
	id: number;
	method: BridgeMethod;
	params?: Record<string, unknown>;
}

export interface BridgeError {
	code: number;
	message: string;
}

export interface BridgeResponse {
	id: number;
	result?: unknown;
	error?: BridgeError;
}

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

export type BridgeEventType =
	| "extension_connected"
	| "extension_disconnected"
	| "active_tab_changed"
	| "session_changed"
	| "session_message"
	| "session_tool"
	| "session_run_state";

export interface BridgeEvent {
	type: "event";
	event: BridgeEventType;
	data?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Abort (server → extension when CLI disconnects mid-request)
// ---------------------------------------------------------------------------

export interface AbortMessage {
	type: "abort";
	id: number;
}

// ---------------------------------------------------------------------------
// Union of all wire messages
// ---------------------------------------------------------------------------

export type BridgeMessage =
	| RegistrationMessage
	| RegisterResult
	| BridgeRequest
	| BridgeResponse
	| BridgeEvent
	| AbortMessage;

// ---------------------------------------------------------------------------
// Command-specific parameter types
// ---------------------------------------------------------------------------

export interface NavigateParams {
	url?: string;
	newTab?: boolean;
	listTabs?: boolean;
	switchToTab?: number;
}

export interface ReplParams {
	title: string;
	code: string;
}

export interface ScreenshotParams {
	maxWidth?: number;
}

export interface EvalParams {
	code: string;
}

export interface SelectElementParams {
	message?: string;
}

export interface SessionHistoryParams {
	last?: number;
	afterMessageIndex?: number;
}

export interface SessionInjectParams {
	expectedSessionId: string;
	role: "user" | "assistant";
	content: string;
	waitForIdle?: boolean;
}

// ---------------------------------------------------------------------------
// Bridge result types
// ---------------------------------------------------------------------------

export interface BridgeStatusResult {
	ok: true;
	ready: true;
	windowId?: number;
	sessionId?: string;
	capabilities?: BridgeCapability[];
	activeTab?: {
		url?: string;
		title?: string;
		tabId?: number;
	};
}

export interface BridgeScreenshotResult {
	mimeType: "image/webp" | "image/png";
	dataUrl: string;
}

export interface BridgeReplFile {
	fileName: string;
	mimeType: string;
	size: number;
	contentBase64: string;
}

export interface BridgeReplResult {
	output: string;
	files: BridgeReplFile[];
}

export interface BridgeServerStatus {
	ok: true;
	extension:
		| {
				connected: true;
				windowId?: number;
				sessionId?: string;
				capabilities?: string[];
				remoteAddress?: string;
		  }
		| { connected: false };
	clients: {
		total: number;
		cli: number;
		extension: number;
	};
	pendingRequests: number;
}

export interface SessionWireAttachment {
	kind: "image" | "file";
	mimeType?: string;
	name?: string;
}

export interface SessionWireMessage {
	messageIndex: number;
	role: "user" | "assistant" | "toolResult" | "navigation";
	text: string;
	timestamp?: number;
	provider?: string;
	model?: string;
	toolCalls?: { name: string; argsSummary: string }[];
	toolName?: string;
	toolCallId?: string;
	isError?: boolean;
	attachments?: SessionWireAttachment[];
}

export interface SessionHistoryResult {
	sessionId?: string;
	persisted: boolean;
	title: string;
	model?: { provider: string; id: string };
	isStreaming: boolean;
	messageCount: number;
	lastMessageIndex: number;
	messages: SessionWireMessage[];
}

export interface SessionInjectResult {
	ok: true;
	sessionId: string;
	messageIndex: number;
}

export interface SessionNewParams {
	/** Optional model to set on the new session (provider/id format, e.g. "anthropic/claude-sonnet-4-6"). */
	model?: string;
}

export interface SessionNewResult {
	ok: true;
	sessionId: string;
	model?: { provider: string; id: string };
}

export interface SessionSetModelParams {
	/** Model in provider/id format (e.g. "anthropic/claude-sonnet-4-6") or just model id. */
	model: string;
	/** Provider name (required if model doesn't contain a slash). */
	provider?: string;
}

export interface SessionSetModelResult {
	ok: true;
	model: { provider: string; id: string };
}

export interface SessionArtifact {
	filename: string;
	content: string;
	createdAt: string;
	updatedAt: string;
}

export interface SessionArtifactsResult {
	sessionId?: string;
	artifacts: SessionArtifact[];
}

export interface SessionChangedEventData {
	sessionId?: string;
	persisted: boolean;
	title: string;
	model?: { provider: string; id: string };
	messageCount: number;
	lastMessageIndex: number;
}

export interface SessionMessageEventData {
	sessionId?: string;
	persisted: boolean;
	message: SessionWireMessage;
}

export interface SessionToolEventData {
	sessionId?: string;
	phase: "start" | "update" | "end";
	toolCallId: string;
	toolName: string;
	isError?: boolean;
	summary?: string;
}

export interface SessionRunStateEventData {
	sessionId?: string;
	state: "started" | "idle";
}

// ---------------------------------------------------------------------------
// Network / config types
// ---------------------------------------------------------------------------

/** Server-side config (bind address). */
export interface BridgeServerConfig {
	host: string;
	port: number;
	token: string;
}

/** Client-side config (connect address). */
export interface BridgeClientConfig {
	url: string;
	token: string;
}

/** Persisted CLI config at ~/.shuvgeist/bridge.json */
export interface CliConfigFile {
	url?: string;
	token?: string;
}

// ---------------------------------------------------------------------------
// Error codes
// ---------------------------------------------------------------------------

export const ErrorCodes = {
	/** No extension target is currently connected to the bridge. */
	NO_EXTENSION_TARGET: -32000,
	/** Token mismatch or missing token during registration. */
	AUTH_FAILED: -32001,
	/** Method name is not in the V1 command set. */
	INVALID_METHOD: -32002,
	/** Tool execution failed in the extension. */
	EXECUTION_ERROR: -32003,
	/** Request timed out waiting for extension response. */
	TIMEOUT: -32004,
	/** Request was aborted (CLI disconnected). */
	ABORTED: -32005,
	/** Client sent a request before completing registration. */
	REGISTRATION_REQUIRED: -32006,
	/** Another extension target is already connected. */
	EXTENSION_ALREADY_CONNECTED: -32007,
	/** Capability exists in protocol but is disabled by local settings. */
	CAPABILITY_DISABLED: -32008,
	/** Requested operation cannot modify the currently active session while streaming. */
	SESSION_BUSY: -32009,
	/** CLI attempted to write to a session that is no longer active. */
	SESSION_MISMATCH: -32010,
	/** There is no active persisted sidepanel session for write operations. */
	NO_ACTIVE_SESSION: -32011,
	/** Another CLI currently holds the write lease for session injection. */
	WRITE_LOCKED: -32012,
} as const;

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

export const BridgeDefaults = {
	HOST: "0.0.0.0",
	PORT: 19285,
	STATUS_TIMEOUT_MS: 10_000,
	REQUEST_TIMEOUT_MS: 60_000,
	SLOW_REQUEST_TIMEOUT_MS: 120_000,
	/** Grace period (ms) for a newly connected socket to send a register message. */
	REGISTER_TIMEOUT_MS: 10_000,
} as const;
