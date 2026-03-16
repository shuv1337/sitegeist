# Sitegeist CORS Proxy

A small self-hosted proxy service that lets the Sitegeist browser extension reach
provider endpoints that enforce CORS restrictions on direct browser requests.

The proxy is intentionally minimal: it filters headers, restricts upstream targets
to a configurable allowlist, and never logs credentials or request bodies.

## Why this exists

Several provider endpoints that Sitegeist needs cannot be called directly from a
browser extension due to CORS policy:

| Provider | Flow |
|---|---|
| `platform.claude.com` | Anthropic OAuth token exchange and refresh |
| `api.anthropic.com` | Anthropic API calls (proxied for OAuth tokens) |
| `github.com` | GitHub Copilot device code and access token exchange |
| `api.z.ai` | ZAI model API (always proxied) |
| `chatgpt.com` | OpenAI Codex backend API (proxied at runtime) |

The proxy forwards requests to these hosts and adds permissive CORS response headers
so the browser extension can receive the response.

## Request format

Sitegeist sends all proxied requests as:

```
GET|POST|OPTIONS /?url=<percent-encoded-upstream-url>
```

Examples:

```
POST /?url=https%3A%2F%2Fplatform.claude.com%2Fv1%2Foauth%2Ftoken
POST /?url=https%3A%2F%2Fgithub.com%2Flogin%2Foauth%2Faccess_token
POST /?url=https%3A%2F%2Fapi.z.ai%2Fv1%2Fmessages
```

The proxy also handles a path-based fallback used by the document extraction tool:

```
GET /<percent-encoded-upstream-url>
```

## Health check

```
GET /health
```

Returns `200 OK` with a JSON body showing the allowed hosts, rate limit, and whether
auth is required.

## Environment variables

| Variable | Default | Description |
|---|---|---|
| `PORT` | `3001` | Port the HTTP server listens on |
| `ALLOWED_HOSTS` | `platform.claude.com,api.anthropic.com,github.com,api.z.ai,chatgpt.com` | Comma-separated list of upstream hostnames the proxy may forward to |
| `PROXY_SECRET` | _(unset)_ | If set, clients must send this value as `X-Proxy-Secret`. Leave unset for local dev |
| `RATE_LIMIT_RPM` | `300` | Max requests per minute per client IP (in-memory sliding window) |
| `MAX_BODY_SIZE` | `10mb` | Maximum inbound request body size |
| `REQUEST_TIMEOUT_MS` | `120000` | Upstream request timeout in milliseconds |

## Running locally (without Docker)

Requires Node 22+.

```bash
cd proxy
npm install
npm run dev
```

The dev server starts on port 3001 and restarts automatically on file changes.
No `PROXY_SECRET` is required in local dev (auth is disabled when the env var is unset).

To test the proxy is working:

```bash
curl http://localhost:3001/health
```

## Running with Docker Compose

From the `proxy/` directory:

```bash
docker compose up -d
```

To override settings without editing the compose file, create a `.env` file in
`proxy/`:

```env
PORT=3001
PROXY_SECRET=change-me-in-production
RATE_LIMIT_RPM=600
```

Then `docker compose up -d` picks it up automatically.

To rebuild after code changes:

```bash
docker compose up -d --build
```

To tail logs:

```bash
docker compose logs -f
```

## Adding hosts to the allowlist

Pass `ALLOWED_HOSTS` as a comma-separated list. The list **replaces** the default;
include all hosts you need.

```env
ALLOWED_HOSTS=platform.claude.com,api.anthropic.com,github.com,api.z.ai,chatgpt.com,api.openai.com
```

Only exact hostname matches are checked (no wildcards). Paths and ports within an
allowed host are not further restricted.

## Configuring Sitegeist to use this proxy

1. Open the Sitegeist side panel.
2. Go to **Settings → API Keys / OAuth**.
3. Find the **CORS Proxy** section.
4. Enable the proxy and set the URL to your proxy's base URL, for example:

   ```
   http://localhost:3001
   ```

   or in production:

   ```
   https://proxy.your-domain.com
   ```

   Do **not** include a trailing slash or path. Sitegeist appends `/?url=…` itself.

If `PROXY_SECRET` is configured on the proxy, you need to pass it from the extension.
Currently the extension does not send a custom header by default, so `PROXY_SECRET`
is best used behind a reverse proxy (nginx, Caddy, Cloudflare Access) that handles
authentication at the network layer rather than relying on a header secret in the
browser.

## Deploying to production

Recommended setup:

1. Build and run the container (via Docker Compose or your container platform).
2. Put a TLS-terminating reverse proxy (nginx, Caddy, Traefik) in front of it.
3. Expose only the TLS port publicly.
4. Set `PROXY_SECRET` or restrict access via your reverse proxy / firewall if
   the endpoint is publicly reachable.
5. Set `ALLOWED_HOSTS` to exactly the hosts Sitegeist needs — no broader.

Example Caddyfile snippet:

```
proxy.your-domain.com {
    reverse_proxy localhost:3001
}
```

## Security notes

- **Allowlist is mandatory.** The proxy rejects any request whose target hostname
  is not in `ALLOWED_HOSTS`. There is no opt-out.
- **Headers are filtered.** Only a known set of headers is forwarded to upstream
  (Authorization, Content-Type, Accept, User-Agent, X-Api-Key, and a few
  provider-specific ones). Browser-injected headers such as `Origin`, `Referer`,
  `Cookie`, and `Host` are stripped.
- **Nothing sensitive is logged.** Log entries contain only the upstream hostname,
  HTTP method, response status, and duration. Authorization headers, request
  bodies, and full URLs are never written to logs.
- **Rate limiting is in-memory.** The rate limiter resets on restart and is not
  shared across multiple instances. For high-availability deployments, put a
  network-level rate limiter (e.g., nginx `limit_req`) in front.

## Logs

All log output is structured JSON on stdout, one object per line:

```json
{"level":"info","time":"2026-01-01T00:00:00.000Z","event":"server_start","port":3001,"allowedHosts":["platform.claude.com","github.com","api.z.ai","chatgpt.com"],"authRequired":false,"rateLimitRpm":300}
{"level":"info","time":"2026-01-01T00:00:01.000Z","event":"proxy_ok","reqId":"a1b2c3d4","method":"POST","upstreamHost":"platform.claude.com","status":200,"durationMs":312}
{"level":"warn","time":"2026-01-01T00:00:02.000Z","event":"host_blocked","reqId":"e5f6a7b8","method":"POST","upstreamHost":"evil.example.com","status":403}
```

Notable events:

| `event` | Meaning |
|---|---|
| `server_start` | Service started |
| `proxy_ok` | Upstream request succeeded |
| `upstream_timeout` | Upstream did not respond within `REQUEST_TIMEOUT_MS` |
| `upstream_error` | Upstream request failed (network error) |
| `host_blocked` | Target hostname not in allowlist |
| `rate_limited` | Client exceeded `RATE_LIMIT_RPM` |
| `auth_failed` | `X-Proxy-Secret` missing or wrong |
