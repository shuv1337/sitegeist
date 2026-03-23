/**
 * Anthropic OAuth flow for browser extensions.
 *
 * Anthropic Max login is handled as a manual code / callback URL paste flow.
 * We open the authorize URL in a new tab, then ask the user to paste either:
 * - the authorization code, or
 * - the full localhost callback URL from the browser address bar
 *
 * This mirrors the fallback flow used by Anthropic's CLI more closely than
 * the previous tab-watcher implementation and avoids relying on an automatic
 * browser-side token exchange after the redirect.
 */

import { generatePKCE, postTokenRequest } from "./browser-oauth.js";
import type { OAuthCredentials } from "./types.js";

const decode = (s: string) => atob(s);
const CLIENT_ID = decode("OWQxYzI1MGEtZTYxYi00NGQ5LTg4ZWQtNTk0NGQxOTYyZjVl");
const AUTHORIZE_URL = "https://claude.ai/oauth/authorize";
const TOKEN_URL = "https://platform.claude.com/v1/oauth/token";
const REDIRECT_URI = "http://localhost:53692/callback";
const SCOPES =
	"org:create_api_key user:profile user:inference user:sessions:claude_code user:mcp_servers user:file_upload";

function parseAuthorizationInput(input: string): { code?: string; state?: string } {
	const value = input.trim();
	if (!value) return {};

	try {
		const url = new URL(value);
		return {
			code: url.searchParams.get("code") ?? undefined,
			state: url.searchParams.get("state") ?? undefined,
		};
	} catch {
		// Not a full URL, keep parsing below.
	}

	if (value.includes("#")) {
		const [code, state] = value.split("#", 2);
		return {
			code: code || undefined,
			state: state || undefined,
		};
	}

	if (value.includes("code=")) {
		const params = new URLSearchParams(value.startsWith("?") ? value.slice(1) : value);
		return {
			code: params.get("code") ?? undefined,
			state: params.get("state") ?? undefined,
		};
	}

	return { code: value };
}

function promptForAuthorizationInput(): string {
	const input = window.prompt(
		[
			"Complete Anthropic login in the opened tab.",
			"",
			"Then paste one of the following here:",
			"• the authorization code",
			"• the full callback URL from the browser address bar",
			"",
			"If the browser redirects to localhost and the page fails to load, copy the full URL and paste it here.",
		].join("\n"),
		"",
	);

	if (input === null) {
		throw new Error("Anthropic login cancelled");
	}

	return input;
}

/**
 * Run the Anthropic OAuth login flow in the browser.
 * Opens a tab for the user to authenticate, then asks the user to paste the
 * resulting code or full callback URL.
 */
export async function loginAnthropic(): Promise<OAuthCredentials> {
	const { verifier, challenge } = await generatePKCE();

	const authParams = new URLSearchParams({
		code: "true",
		client_id: CLIENT_ID,
		response_type: "code",
		redirect_uri: REDIRECT_URI,
		scope: SCOPES,
		code_challenge: challenge,
		code_challenge_method: "S256",
		state: verifier,
	});

	await chrome.tabs.create({ url: `${AUTHORIZE_URL}?${authParams.toString()}`, active: true });

	const parsed = parseAuthorizationInput(promptForAuthorizationInput());
	const code = parsed.code;
	const state = parsed.state ?? verifier;

	if (!code) throw new Error("Missing authorization code");
	if (parsed.state && parsed.state !== verifier) throw new Error("OAuth state mismatch");

	const tokenData = await postTokenRequest(TOKEN_URL, {
		grant_type: "authorization_code",
		client_id: CLIENT_ID,
		code,
		state,
		redirect_uri: REDIRECT_URI,
		code_verifier: verifier,
	});

	const access = tokenData.access_token as string;
	const refresh = tokenData.refresh_token as string;
	const expiresIn = tokenData.expires_in as number;

	if (!access || !refresh || typeof expiresIn !== "number") {
		throw new Error("Token response missing required fields");
	}

	return {
		providerId: "anthropic",
		access,
		refresh,
		expires: Date.now() + expiresIn * 1000 - 5 * 60 * 1000,
	};
}

/**
 * Refresh an Anthropic OAuth token.
 */
export async function refreshAnthropic(credentials: OAuthCredentials): Promise<OAuthCredentials> {
	const tokenData = await postTokenRequest(TOKEN_URL, {
		grant_type: "refresh_token",
		client_id: CLIENT_ID,
		refresh_token: credentials.refresh,
	});

	const access = tokenData.access_token as string;
	const refresh = tokenData.refresh_token as string;
	const expiresIn = tokenData.expires_in as number;

	if (!access || !refresh || typeof expiresIn !== "number") {
		throw new Error("Token refresh response missing required fields");
	}

	return {
		providerId: "anthropic",
		access,
		refresh,
		expires: Date.now() + expiresIn * 1000 - 5 * 60 * 1000,
	};
}
