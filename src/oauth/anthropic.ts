/**
 * Anthropic OAuth flow for browser extensions.
 *
 * Anthropic Max login is handled as a manual code / callback URL paste flow.
 * We open the authorize URL in a new tab, then the caller provides the
 * authorization code or full callback URL via a callback (non-blocking
 * in-panel input instead of window.prompt which blocks the entire browser).
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

export function parseAuthorizationInput(input: string): { code?: string; state?: string } {
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

/**
 * Callback type for collecting the authorization code from the user.
 * The caller should show an inline input and resolve the promise when the user submits.
 */
export type AnthropicCodeCallback = () => Promise<string>;

/**
 * Run the Anthropic OAuth login flow in the browser.
 * Opens a tab for the user to authenticate, then waits for the caller to
 * provide the authorization code or callback URL via the onCodeInput callback.
 */
export async function loginAnthropic(onCodeInput: AnthropicCodeCallback): Promise<OAuthCredentials> {
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

	const rawInput = await onCodeInput();
	const parsed = parseAuthorizationInput(rawInput);
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
