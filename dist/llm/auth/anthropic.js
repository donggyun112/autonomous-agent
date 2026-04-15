// Anthropic OAuth — login (PKCE) + refresh.
//
// Ported and simplified from:
//   - @mariozechner/pi-ai/src/utils/oauth/anthropic.ts (reference/pi-mono)
//   - in7pm/src/server/providers/claude.ts (reference for manual-code pattern)
//
// The manual-code fallback is used here — starting a localhost callback server
// is nicer but adds complexity and opens a port. For a contemplative agent
// running as a daemon, asking the user to paste the code once is fine.
//
// After login the credentials are saved by the caller (via storage.ts).
// Refresh is performed by refreshAnthropicToken.
import { generatePKCE } from "./pkce.js";
// Public Anthropic OAuth client id used by Claude Code, IN7PM, pi-ai.
// This is the same public client used across these open source projects.
const CLIENT_ID = "9d1c250a-e61b-44d9-88ed-5944d1962f5e";
const AUTHORIZE_URL = "https://claude.ai/oauth/authorize";
const TOKEN_URL = "https://platform.claude.com/v1/oauth/token";
const REDIRECT_URI = "https://console.anthropic.com/oauth/code/callback";
const SCOPES = "org:create_api_key user:profile user:inference user:sessions:claude_code user:mcp_servers user:file_upload";
function parseAuthorizationInput(input) {
    const value = input.trim();
    if (!value)
        return {};
    // Full callback URL pasted
    try {
        const url = new URL(value);
        return {
            code: url.searchParams.get("code") ?? undefined,
            state: url.searchParams.get("state") ?? undefined,
        };
    }
    catch {
        // not a URL
    }
    // "code#state" format (Anthropic sometimes returns this)
    if (value.includes("#")) {
        const [code, state] = value.split("#", 2);
        return { code, state };
    }
    // "code=...&state=..." query-string fragment
    if (value.includes("code=")) {
        const params = new URLSearchParams(value);
        return {
            code: params.get("code") ?? undefined,
            state: params.get("state") ?? undefined,
        };
    }
    // Bare code
    return { code: value };
}
async function postJson(url, body) {
    const response = await fetch(url, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
            "User-Agent": "autonomous-agent/0.1",
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(30_000),
    });
    const text = await response.text();
    if (!response.ok) {
        throw new Error(`HTTP ${response.status} from ${url}: ${text}`);
    }
    return text;
}
// Begin the login flow. Returns the credentials on success.
export async function loginAnthropic(callbacks) {
    const { verifier, challenge } = await generatePKCE();
    // Anthropic's convention: the state is the PKCE verifier itself.
    const state = verifier;
    const params = new URLSearchParams({
        code: "true",
        client_id: CLIENT_ID,
        response_type: "code",
        redirect_uri: REDIRECT_URI,
        scope: SCOPES,
        code_challenge: challenge,
        code_challenge_method: "S256",
        state,
    });
    const authUrl = `${AUTHORIZE_URL}?${params.toString()}`;
    callbacks.onAuthUrl(authUrl);
    const input = await callbacks.onPromptCode();
    const parsed = parseAuthorizationInput(input);
    if (!parsed.code) {
        throw new Error("No authorization code provided.");
    }
    if (parsed.state && parsed.state !== verifier) {
        throw new Error("OAuth state mismatch.");
    }
    const responseBody = await postJson(TOKEN_URL, {
        grant_type: "authorization_code",
        client_id: CLIENT_ID,
        code: parsed.code,
        state: parsed.state ?? verifier,
        redirect_uri: REDIRECT_URI,
        code_verifier: verifier,
    });
    let data;
    try {
        data = JSON.parse(responseBody);
    }
    catch (err) {
        throw new Error(`Token exchange returned invalid JSON: ${responseBody}`);
    }
    if (!data.access_token) {
        throw new Error(data.error ?? `Token exchange failed: ${responseBody}`);
    }
    return {
        access: data.access_token,
        refresh: data.refresh_token,
        // Expire 5 minutes early to give a refresh buffer.
        expires: Date.now() + data.expires_in * 1000 - 5 * 60 * 1000,
    };
}
// Refresh an expired (or near-expired) token.
export async function refreshAnthropicToken(refreshToken) {
    const responseBody = await postJson(TOKEN_URL, {
        grant_type: "refresh_token",
        client_id: CLIENT_ID,
        refresh_token: refreshToken,
    });
    let data;
    try {
        data = JSON.parse(responseBody);
    }
    catch {
        throw new Error(`Refresh returned invalid JSON: ${responseBody}`);
    }
    if (!data.access_token) {
        throw new Error(`Refresh failed: ${responseBody}`);
    }
    return {
        access: data.access_token,
        refresh: data.refresh_token,
        expires: Date.now() + data.expires_in * 1000 - 5 * 60 * 1000,
    };
}
//# sourceMappingURL=anthropic.js.map