/**
 * CLI client for the Shuvgeist bridge.
 *
 * Usage:
 *   shuvgeist serve [--host HOST] [--port PORT] [--token TOKEN]
 *   shuvgeist status
 *   shuvgeist navigate <url> [--new-tab]
 *   shuvgeist tabs
 *   shuvgeist switch <tabId>
 *   shuvgeist repl <code>
 *   shuvgeist repl -f <file.js>
 *   shuvgeist screenshot [--out file.png]
 *   shuvgeist eval <code>
 *   shuvgeist select <message>
 *
 * Exit codes:
 *   0 — success
 *   1 — command/runtime error
 *   2 — no extension target connected
 *   3 — auth/configuration/network error
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { WebSocket } from "ws";
import {
	BridgeDefaults,
	type BridgeMethod,
	type BridgeReplResult,
	type BridgeRequest,
	type BridgeResponse,
	type BridgeScreenshotResult,
	type BridgeServerStatus,
	type CliConfigFile,
	ErrorCodes,
	type RegisterResult,
} from "./protocol.js";
import { BridgeServer } from "./server.js";

function getConfigPath(): string {
	return join(homedir(), ".shuvgeist", "bridge.json");
}

function readConfigFile(): CliConfigFile {
	const path = getConfigPath();
	if (!existsSync(path)) return {};
	try {
		return JSON.parse(readFileSync(path, "utf-8")) as CliConfigFile;
	} catch {
		return {};
	}
}

function resolveBridgeUrl(flags: { url?: string; host?: string; port?: string }): string {
	const file = readConfigFile();
	let url = flags.url || process.env.SHUVGEIST_BRIDGE_URL || file.url || "";
	if (!url) {
		const host = flags.host || process.env.SHUVGEIST_BRIDGE_HOST || "127.0.0.1";
		const port = flags.port || process.env.SHUVGEIST_BRIDGE_PORT || String(BridgeDefaults.PORT);
		url = `ws://${host}:${port}/ws`;
	}
	return url;
}

function resolveConfig(flags: { url?: string; host?: string; port?: string; token?: string }): {
	url: string;
	token: string;
} {
	const file = readConfigFile();
	const token = flags.token || process.env.SHUVGEIST_BRIDGE_TOKEN || file.token || "";
	if (!token) {
		console.error("Error: bridge token is required.");
		console.error("");
		console.error("Set it via:");
		console.error("  --token <token>");
		console.error("  SHUVGEIST_BRIDGE_TOKEN env var");
		console.error("  " + getConfigPath());
		process.exit(3);
	}
	return { url: resolveBridgeUrl(flags), token };
}

function bridgeStatusUrl(wsUrl: string): string {
	const url = new URL(wsUrl);
	url.protocol = url.protocol === "wss:" ? "https:" : "http:";
	url.pathname = "/status";
	url.search = "";
	url.hash = "";
	return url.toString();
}

function generateRequestId(): number {
	return Number(
		`${Date.now().toString().slice(-10)}${Math.floor(Math.random() * 1000)
			.toString()
			.padStart(3, "0")}`,
	);
}

function parseTimeout(value: string | undefined, fallbackMs?: number): number | undefined {
	if (!value) return fallbackMs;
	if (value === "0" || value === "none") return undefined;
	const trimmed = value.trim().toLowerCase();
	if (trimmed.endsWith("ms")) return Number.parseInt(trimmed.slice(0, -2), 10);
	if (trimmed.endsWith("s")) return Number.parseInt(trimmed.slice(0, -1), 10) * 1000;
	if (trimmed.endsWith("m")) return Number.parseInt(trimmed.slice(0, -1), 10) * 60_000;
	const parsed = Number.parseInt(trimmed, 10);
	return Number.isFinite(parsed) ? parsed : fallbackMs;
}

function isNetworkOrConfigError(err: unknown): boolean {
	const code = typeof err === "object" && err && "code" in err ? String((err as { code?: string }).code) : "";
	const message = err instanceof Error ? err.message : String(err || "");
	const networkCodes = new Set([
		"ECONNREFUSED",
		"ECONNRESET",
		"EHOSTUNREACH",
		"ENOTFOUND",
		"ETIMEDOUT",
		"EAI_AGAIN",
		"ERR_INVALID_URL",
	]);
	if (networkCodes.has(code)) return true;
	return (
		message.includes("ECONNREFUSED") ||
		message.includes("ECONNRESET") ||
		message.includes("EHOSTUNREACH") ||
		message.includes("ENOTFOUND") ||
		message.includes("ETIMEDOUT") ||
		message.includes("EAI_AGAIN") ||
		message.includes("timeout") ||
		message.includes("Registration failed") ||
		message.includes("Connection closed before response") ||
		message.includes("Invalid URL")
	);
}

function sendRequest(url: string, token: string, request: BridgeRequest, timeoutMs?: number): Promise<BridgeResponse> {
	return new Promise((resolve, reject) => {
		const ws = new WebSocket(url);
		let settled = false;
		let timeout: ReturnType<typeof setTimeout> | undefined;

		if (timeoutMs && timeoutMs > 0) {
			timeout = setTimeout(() => {
				if (!settled) {
					settled = true;
					ws.close();
					reject(Object.assign(new Error(`Connection timeout after ${timeoutMs}ms`), { code: "ETIMEDOUT" }));
				}
			}, timeoutMs);
		}

		ws.on("open", () => {
			ws.send(
				JSON.stringify({
					type: "register",
					role: "cli",
					token,
					name: "shuvgeist-cli",
				}),
			);
		});

		ws.on("message", (data: Buffer | string) => {
			const msg = JSON.parse(typeof data === "string" ? data : data.toString("utf-8"));
			if (msg.type === "register_result") {
				const reg = msg as RegisterResult;
				if (!reg.ok) {
					settled = true;
					if (timeout) clearTimeout(timeout);
					ws.close();
					reject(Object.assign(new Error("Registration failed: " + (reg.error || "unknown")), { code: "EAUTH" }));
					return;
				}
				ws.send(JSON.stringify(request));
				return;
			}
			if ("id" in msg && msg.id === request.id) {
				settled = true;
				if (timeout) clearTimeout(timeout);
				ws.close();
				resolve(msg as BridgeResponse);
			}
		});

		ws.on("error", (err: Error) => {
			if (!settled) {
				settled = true;
				if (timeout) clearTimeout(timeout);
				reject(err);
			}
		});

		ws.on("close", () => {
			if (timeout) clearTimeout(timeout);
			if (!settled) {
				settled = true;
				reject(Object.assign(new Error("Connection closed before response"), { code: "ECONNRESET" }));
			}
		});
	});
}

function printError(message: string, jsonMode: boolean): void {
	if (jsonMode) console.log(JSON.stringify({ error: { code: -1, message } }, null, 2));
	else console.error("Error: " + message);
}

function printResult(response: BridgeResponse, jsonMode: boolean): void {
	if (response.error) {
		if (jsonMode) console.log(JSON.stringify({ error: response.error }, null, 2));
		else console.error("Error: " + response.error.message);
		return;
	}
	if (jsonMode) {
		console.log(JSON.stringify(response.result, null, 2));
		return;
	}
	const result = response.result as unknown;
	if (result === null || result === undefined) console.log("OK");
	else if (typeof result === "string") console.log(result);
	else console.log(JSON.stringify(result, null, 2));
}

function exitCodeForResponse(response: BridgeResponse): number {
	if (!response.error) return 0;
	if (response.error.code === ErrorCodes.NO_EXTENSION_TARGET) return 2;
	if (
		response.error.code === ErrorCodes.AUTH_FAILED ||
		response.error.code === ErrorCodes.INVALID_METHOD ||
		response.error.code === ErrorCodes.REGISTRATION_REQUIRED
	) {
		return 3;
	}
	return 1;
}

async function fetchBridgeStatus(flags: { url?: string; host?: string; port?: string; json?: boolean }): Promise<void> {
	const wsUrl = resolveBridgeUrl(flags);
	const statusUrl = bridgeStatusUrl(wsUrl);
	const jsonMode = flags.json || false;
	try {
		const controller = new AbortController();
		const timeoutMs = parseTimeout((flags as { timeout?: string }).timeout, BridgeDefaults.STATUS_TIMEOUT_MS);
		let timeout: ReturnType<typeof setTimeout> | undefined;
		if (timeoutMs && timeoutMs > 0) {
			timeout = setTimeout(() => controller.abort(), timeoutMs);
		}
		const response = await fetch(statusUrl, { signal: controller.signal });
		if (timeout) clearTimeout(timeout);
		if (!response.ok) {
			throw new Error(`Status request failed: HTTP ${response.status}`);
		}
		const status = (await response.json()) as BridgeServerStatus;
		if (jsonMode) {
			console.log(JSON.stringify(status, null, 2));
		} else {
			console.log(`Bridge: ${statusUrl}`);
			console.log(`Extension connected: ${status.extension.connected ? "yes" : "no"}`);
			if (status.extension.connected) {
				console.log(`Window ID: ${status.extension.windowId ?? "unknown"}`);
				console.log(`Session ID: ${status.extension.sessionId ?? "unknown"}`);
				console.log(`Capabilities: ${(status.extension.capabilities || []).join(", ") || "none"}`);
				console.log(`Extension address: ${status.extension.remoteAddress ?? "unknown"}`);
			}
			console.log(
				`Clients: cli=${status.clients.cli} extension=${status.clients.extension} total=${status.clients.total}`,
			);
			console.log(`Pending requests: ${status.pendingRequests}`);
		}
		process.exit(0);
	} catch (err) {
		printError(err instanceof Error ? err.message : String(err), jsonMode);
		process.exit(3);
	}
}

async function cmdServe(args: string[]): Promise<void> {
	const { values } = parseArgs({
		args,
		options: {
			host: { type: "string", default: process.env.SHUVGEIST_BRIDGE_HOST || BridgeDefaults.HOST },
			port: { type: "string", default: process.env.SHUVGEIST_BRIDGE_PORT || String(BridgeDefaults.PORT) },
			token: { type: "string", default: process.env.SHUVGEIST_BRIDGE_TOKEN || "" },
		},
		allowPositionals: false,
	});

	const token = values.token || "";
	if (!token) {
		const generated = generateToken();
		console.log("No token provided. Generated token: " + generated);
		console.log("Save it to " + getConfigPath() + ' or pass --token="' + generated + '"');
		console.log("");
		const configDir = join(homedir(), ".shuvgeist");
		mkdirSync(configDir, { recursive: true });
		const configPath = getConfigPath();
		const existing = readConfigFile();
		existing.token = generated;
		writeFileSync(configPath, JSON.stringify(existing, null, 2) + "\n");
		console.log("Token saved to " + configPath);
		console.log("");
		new BridgeServer({ host: values.host!, port: Number.parseInt(values.port!, 10), token: generated }).start();
		return;
	}

	new BridgeServer({ host: values.host!, port: Number.parseInt(values.port!, 10), token }).start();
}

async function cmdOneShot(
	method: BridgeMethod,
	params: Record<string, unknown>,
	flags: { url?: string; host?: string; port?: string; token?: string; json?: boolean; timeout?: string },
	defaultTimeoutMs?: number,
): Promise<BridgeResponse> {
	const { url, token } = resolveConfig(flags);
	const timeoutMs = parseTimeout(flags.timeout, defaultTimeoutMs);
	const request: BridgeRequest = {
		id: generateRequestId(),
		method,
		params,
	};
	return sendRequest(url, token, request, timeoutMs);
}

async function runOneShot(
	method: BridgeMethod,
	params: Record<string, unknown>,
	flags: { url?: string; host?: string; port?: string; token?: string; json?: boolean; timeout?: string },
	defaultTimeoutMs?: number,
): Promise<void> {
	const jsonMode = flags.json || false;
	try {
		const response = await cmdOneShot(method, params, flags, defaultTimeoutMs);
		printResult(response, jsonMode);
		process.exit(exitCodeForResponse(response));
	} catch (err) {
		printError(err instanceof Error ? err.message : String(err), jsonMode);
		process.exit(isNetworkOrConfigError(err) ? 3 : 1);
	}
}

async function cmdScreenshot(flags: {
	url?: string;
	host?: string;
	port?: string;
	token?: string;
	json?: boolean;
	out?: string;
	maxWidth?: string;
	timeout?: string;
}): Promise<void> {
	const jsonMode = flags.json || false;
	const params: Record<string, unknown> = {};
	if (flags.maxWidth) params.maxWidth = Number.parseInt(flags.maxWidth, 10);
	try {
		const response = await cmdOneShot("screenshot", params, flags, BridgeDefaults.SLOW_REQUEST_TIMEOUT_MS);
		if (response.error) {
			printResult(response, jsonMode);
			process.exit(exitCodeForResponse(response));
		}
		const result = response.result as BridgeScreenshotResult;
		if (flags.out) {
			if (!result?.dataUrl) {
				throw new Error("Screenshot response did not include dataUrl");
			}
			const base64 = result.dataUrl.replace(/^data:image\/[^;]+;base64,/, "");
			writeFileSync(flags.out, Buffer.from(base64, "base64"));
			if (!jsonMode) console.log("Screenshot saved to " + flags.out);
		} else {
			printResult(response, jsonMode);
		}
		process.exit(0);
	} catch (err) {
		printError(err instanceof Error ? err.message : String(err), jsonMode);
		process.exit(isNetworkOrConfigError(err) ? 3 : 1);
	}
}

async function cmdRepl(
	code: string,
	flags: {
		url?: string;
		host?: string;
		port?: string;
		token?: string;
		json?: boolean;
		writeFiles?: string;
		timeout?: string;
	},
): Promise<void> {
	const jsonMode = flags.json || false;
	try {
		const response = await cmdOneShot(
			"repl",
			{ title: "CLI REPL", code },
			flags,
			BridgeDefaults.SLOW_REQUEST_TIMEOUT_MS,
		);
		if (response.error) {
			printResult(response, jsonMode);
			process.exit(exitCodeForResponse(response));
		}
		const result = response.result as BridgeReplResult;
		if (jsonMode) {
			console.log(JSON.stringify(result, null, 2));
		} else {
			if (result?.output) console.log(result.output);
			if (result?.files?.length > 0) {
				console.log(`\n${result.files.length} file(s) returned`);
				if (flags.writeFiles) {
					mkdirSync(flags.writeFiles, { recursive: true });
					for (const file of result.files) {
						const outPath = join(flags.writeFiles, file.fileName || "file");
						writeFileSync(outPath, Buffer.from(file.contentBase64 || "", "base64"));
						console.log("  wrote " + outPath);
					}
				}
			}
		}
		process.exit(0);
	} catch (err) {
		printError(err instanceof Error ? err.message : String(err), jsonMode);
		process.exit(isNetworkOrConfigError(err) ? 3 : 1);
	}
}

function generateToken(): string {
	const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
	let result = "";
	const bytes = new Uint8Array(32);
	crypto.getRandomValues(bytes);
	for (const b of bytes) result += chars[b % chars.length];
	return result;
}

function printUsage(): void {
	console.log(`shuvgeist — CLI bridge for the Shuvgeist browser extension

Usage:
  shuvgeist serve [--host HOST] [--port PORT] [--token TOKEN]
  shuvgeist status [--json] [--timeout 10s]
  shuvgeist navigate <url> [--new-tab] [--json] [--timeout 60s]
  shuvgeist tabs [--json] [--timeout 60s]
  shuvgeist switch <tabId> [--json] [--timeout 60s]
  shuvgeist repl <code> [--json] [--write-files <dir>] [--timeout 120s]
  shuvgeist repl -f <file.js> [--json] [--write-files <dir>] [--timeout 120s]
  shuvgeist screenshot [--out file.png] [--max-width N] [--json] [--timeout 120s]
  shuvgeist eval <code> [--json] [--timeout 120s]
  shuvgeist select <message> [--json] [--timeout none]

Global options:
  --url <ws://...>    Bridge server URL
  --host <host>       Bridge server host (for constructing URL)
  --port <port>       Bridge server port (for constructing URL)
  --token <token>     Bridge auth token
  --timeout <value>   Timeout (e.g. 30s, 2m, 1500ms, none)
  --json              Machine-readable JSON output

Config file: ~/.shuvgeist/bridge.json
Environment: SHUVGEIST_BRIDGE_URL, SHUVGEIST_BRIDGE_HOST,
             SHUVGEIST_BRIDGE_PORT, SHUVGEIST_BRIDGE_TOKEN

Exit codes:
  0  success
  1  command/runtime error
  2  no extension target connected
  3  auth/configuration/network error
`);
}

async function main(): Promise<void> {
	const args = process.argv.slice(2);
	if (args.length === 0 || args[0] === "--help" || args[0] === "-h") {
		printUsage();
		process.exit(0);
	}

	const command = args[0];
	const rest = args.slice(1);
	const globalFlags: Record<string, string | boolean | undefined> = {};
	const positionals: string[] = [];
	let i = 0;
	while (i < rest.length) {
		const arg = rest[i];
		if (arg === "--json") globalFlags.json = true;
		else if (arg === "--new-tab") globalFlags.newTab = true;
		else if (arg === "--url" && i + 1 < rest.length) globalFlags.url = rest[++i];
		else if (arg === "--host" && i + 1 < rest.length) globalFlags.host = rest[++i];
		else if (arg === "--port" && i + 1 < rest.length) globalFlags.port = rest[++i];
		else if (arg === "--token" && i + 1 < rest.length) globalFlags.token = rest[++i];
		else if (arg === "--timeout" && i + 1 < rest.length) globalFlags.timeout = rest[++i];
		else if (arg === "--out" && i + 1 < rest.length) globalFlags.out = rest[++i];
		else if (arg === "--max-width" && i + 1 < rest.length) globalFlags.maxWidth = rest[++i];
		else if (arg === "--write-files" && i + 1 < rest.length) globalFlags.writeFiles = rest[++i];
		else if (arg === "-f" && i + 1 < rest.length) globalFlags.file = rest[++i];
		else positionals.push(arg);
		i++;
	}

	const flags = globalFlags as Record<string, any>;

	switch (command) {
		case "serve":
			await cmdServe(rest);
			break;
		case "status":
			await fetchBridgeStatus(flags);
			break;
		case "navigate": {
			const url = positionals[0];
			if (!url) {
				console.error("Usage: shuvgeist navigate <url> [--new-tab]");
				process.exit(1);
			}
			await runOneShot(
				"navigate",
				flags.newTab ? { url, newTab: true } : { url },
				flags,
				BridgeDefaults.REQUEST_TIMEOUT_MS,
			);
			break;
		}
		case "tabs":
			await runOneShot("navigate", { listTabs: true }, flags, BridgeDefaults.REQUEST_TIMEOUT_MS);
			break;
		case "switch": {
			const tabId = positionals[0];
			if (!tabId) {
				console.error("Usage: shuvgeist switch <tabId>");
				process.exit(1);
			}
			await runOneShot(
				"navigate",
				{ switchToTab: Number.parseInt(tabId, 10) },
				flags,
				BridgeDefaults.REQUEST_TIMEOUT_MS,
			);
			break;
		}
		case "repl": {
			let code = positionals.join(" ");
			if (flags.file) code = readFileSync(flags.file as string, "utf-8");
			if (!code) {
				console.error("Usage: shuvgeist repl <code> or shuvgeist repl -f <file.js>");
				process.exit(1);
			}
			await cmdRepl(code, flags);
			break;
		}
		case "screenshot":
			await cmdScreenshot(flags);
			break;
		case "eval": {
			const code = positionals.join(" ");
			if (!code) {
				console.error("Usage: shuvgeist eval <code>");
				process.exit(1);
			}
			await runOneShot("eval", { code }, flags, BridgeDefaults.SLOW_REQUEST_TIMEOUT_MS);
			break;
		}
		case "select": {
			const message = positionals.join(" ");
			if (!message) {
				console.error("Usage: shuvgeist select <message>");
				process.exit(1);
			}
			await runOneShot("select_element", { message }, flags, undefined);
			break;
		}
		default:
			console.error("Unknown command: " + command);
			console.error("Run 'shuvgeist --help' for usage.");
			process.exit(1);
	}
}

main().catch((err) => {
	console.error("Fatal: " + (err instanceof Error ? err.message : String(err)));
	process.exit(1);
});
