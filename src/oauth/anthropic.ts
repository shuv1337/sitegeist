/**
 * Anthropic OAuth flow for browser extensions.
 *
 * Primary path: auto-detect the localhost redirect via tab URL watching
 * (same as upstream sitegeist). The tab redirects to localhost:53692 which
 * fails to load, but the extension intercepts the URL and extracts the code.
 *
 * Fallback: if the user closes the tab or the redirect is missed, the caller
 * can provide a manual code input callback so the user can paste the callback
 * URL or authorization code.
 */

import { generatePKCE, postTokenRequest, waitForOAuthRedirect } from "./browser-oauth.js";
import type { OAuthCredentials } from "./types.js";

const decode = (s: string) => atob(s);
const CLIENT_ID = decode("OWQxYzI1MGEtZTYxYi00NGQ5LTg4ZWQtNTk0NGQxOTYyZjVl");
const AUTHORIZE_URL = "https://claude.ai/oauth/authorize";
const TOKEN_URL = "https://platform.claude.com/v1/oauth/token";
const REDIRECT_URI = "http://localhost:53692/callback";
const REDIRECT_HOST = "localhost:53692";
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
 *
 * Opens a tab, watches for the localhost redirect, and exchanges the code.
 * If onCodeInput is provided, it races with the redirect watcher so the user
 * can manually paste the callback URL if auto-detection fails.
 */
export async function loginAnthropic(onCodeInput?: AnthropicCodeCallback): Promise<OAuthCredentials> {
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

	let code: string | undefined;
	let state: string | undefined;

	if (onCodeInput) {
		// Race: auto redirect watcher vs manual paste
		const redirectPromise = waitForOAuthRedirect(`${AUTHORIZE_URL}?${authParams.toString()}`, REDIRECT_HOST)
			.then((url) => ({ source: "redirect" as const, url }))
			.catch(() => null);

		const manualPromise = onCodeInput()
			.then((input) => ({ source: "manual" as const, input }))
			.catch(() => null);

		const winner = await Promise.race([redirectPromise, manualPromise]);

		if (winner?.source === "redirect") {
			code = winner.url.searchParams.get("code") ?? undefined;
			state = winner.url.searchParams.get("state") ?? undefined;
		} else if (winner?.source === "manual" && winner.input) {
			const parsed = parseAuthorizationInput(winner.input);
			code = parsed.code;
			state = parsed.state ?? verifier;
		}

		// If first winner produced nothing, wait for the other
		if (!code) {
			const other = winner?.source === "redirect" ? await manualPromise : await redirectPromise;
			if (other?.source === "redirect") {
				code = other.url.searchParams.get("code") ?? undefined;
				state = other.url.searchParams.get("state") ?? undefined;
			} else if (other?.source === "manual" && other.input) {
				const parsed = parseAuthorizationInput(other.input);
				code = parsed.code;
				state = parsed.state ?? verifier;
			}
		}
	} else {
		// No manual fallback — just watch for redirect
		const redirectUrl = await waitForOAuthRedirect(`${AUTHORIZE_URL}?${authParams.toString()}`, REDIRECT_HOST);
		code = redirectUrl.searchParams.get("code") ?? undefined;
		state = redirectUrl.searchParams.get("state") ?? undefined;
	}

	if (!code) throw new Error("Missing authorization code");
	if (!state) state = verifier;
	if (state !== verifier) throw new Error("OAuth state mismatch");

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
