/**
 * Anthropic OAuth flow for browser extensions.
 *
 * Uses the same client ID and endpoints as the CLI,
 * but replaces the local HTTP callback server with tab URL watching.
 * CORS restrictions on platform.claude.com are handled by
 * declarativeNetRequest rules in the manifest.
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

/**
 * Run the Anthropic OAuth login flow in the browser.
 * Opens a tab for the user to authenticate, watches for the redirect.
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

	const redirectUrl = await waitForOAuthRedirect(`${AUTHORIZE_URL}?${authParams.toString()}`, REDIRECT_HOST);

	const code = redirectUrl.searchParams.get("code");
	const state = redirectUrl.searchParams.get("state");

	if (!code) throw new Error("Missing authorization code in redirect");
	if (!state) throw new Error("Missing state in redirect");
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
