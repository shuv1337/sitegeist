---
name: shuvgeist
description: "Control Chrome/Edge through the Shuvgeist CLI bridge. Use when the user wants browser automation, page inspection, workflow execution, screenshots, semantic element targeting, frame inspection, network capture, device emulation, performance tracing, or debugger-backed access from the terminal."
---

# Shuvgeist Browser Automation

Control a Chrome/Edge browser through the Shuvgeist extension sidepanel using the `shuvgeist` CLI.

## When to use this skill

Use Shuvgeist when a task needs a real browser that the user already has open, especially when you need to:

- navigate and switch tabs
- run JavaScript in page context
- capture screenshots
- inspect iframes
- generate semantic page snapshots
- locate elements by role, text, or label
- reuse stable ref IDs across follow-up actions
- run multi-step browser workflows
- inspect network traffic and export curl commands
- emulate devices or custom viewports
- collect performance metrics or traces
- access MAIN-world state or cookies via DevTools Protocol

Prefer this skill over raw HTTP scraping when the site depends on browser state, auth, client-side rendering, or user-visible interaction.

## Prerequisites

The bridge requires three components:

1. Extension: Shuvgeist loaded in Chrome/Edge with the sidepanel open
2. Bridge server: `shuvgeist serve`
3. CLI: `shuvgeist` commands from the terminal

The token is stored in `~/.shuvgeist/bridge.json`. The extension must have the bridge enabled in `Settings > Bridge` with a matching token.

If `shuvgeist status` returns exit code `2`, the extension sidepanel is not connected and the user needs to open it.

## First step

Always verify bridge connectivity before issuing browser commands:

```bash
shuvgeist status
```

## Core command surface

### Navigate and tabs

```bash
shuvgeist navigate "https://example.com"
shuvgeist navigate "https://example.com" --new-tab
shuvgeist tabs --json
shuvgeist switch <tabId>
```

Use `tabs --json` when you need stable `tabId` values for later `--tab-id` targeting.

### Screenshot

```bash
shuvgeist screenshot --out /tmp/page.webp
shuvgeist screenshot --json
shuvgeist screenshot --out /tmp/page.webp --max-width 800
```

Screenshots are token-efficient WebP output. Use `--json` when another tool needs the base64 data URL.

### REPL and page JavaScript

The REPL runs in an extension sandbox. Use `browserjs()` to execute code in the actual page context.

```bash
shuvgeist repl 'return await browserjs(() => document.title)'

shuvgeist repl 'return await browserjs(() => {
  return Array.from(document.querySelectorAll("h2")).map((h) => h.textContent)
})'

shuvgeist repl -f scrape.js --write-files ./output
```

Important:

- Code outside `browserjs()` runs in the sandbox, not the page.
- Code inside `browserjs()` runs in the page's user-script world.
- Use the REPL for deterministic DOM reads/writes when CSS selectors are already known.

### MAIN-world eval

Requires sensitive browser data access enabled in Bridge settings.

```bash
shuvgeist eval "document.title"
shuvgeist eval "window.__APP_STATE__" --tab-id 123
```

Use this when `browserjs()` cannot see page-owned globals, framework state, or MAIN-world values.

### Cookies

Requires sensitive browser data access enabled in Bridge settings.

```bash
shuvgeist cookies
```

This reads current-site cookies, including HttpOnly cookies.

### Interactive element picking

```bash
shuvgeist select "Click the login button"
```

This waits for user interaction and has no timeout by default unless you pass `--timeout`.

## New deterministic automation surface

### Workflow run and validate

Use workflows when you want one bounded bridge request to run a multi-step browser flow.

```bash
shuvgeist workflow validate --file workflow.json
shuvgeist workflow run --file workflow.json
shuvgeist workflow run --file workflow.json --arg query=shoes --arg urls='["https://a","https://b"]'
shuvgeist workflow run --file workflow.json --dry-run
```

Workflow model:

- `steps` execute sequentially
- `repeat` and `each` loops are supported
- exact token substitution like `"%{urls}"` preserves type
- interpolated strings like `"hello %{name}"` produce strings
- `as` captures previous step results
- `defaultWait` and per-step `wait` data are supported
- disallowed inside workflows: `workflow_run`, `workflow_validate`, `select_element`

Use workflow mode when extra round trips would be wasteful or brittle.

### Page snapshots

Use snapshots when you need a compact semantic representation of a page instead of hand-authored selectors.

```bash
shuvgeist snapshot --json
shuvgeist snapshot --tab-id 123 --frame-id 7 --max-entries 80 --json
```

Snapshots return:

- page URL and title
- semantic entries for visible/interactive elements
- candidate selectors
- stable `snapshotId` values
- frame-aware metadata

### Semantic locator lookup

Use locators to find likely elements by meaning instead of CSS:

```bash
shuvgeist locate role button --name "Sign in" --json
shuvgeist locate text "Add to cart" --json
shuvgeist locate label "Email address" --json
```

Locator results include:

- ranked matches
- match reasons and scores
- `refId` values for follow-up actions
- the matched snapshot entry

### Ref actions

Ref IDs let you act on previously located elements without repeating the semantic search every time.

```bash
shuvgeist ref click <refId>
shuvgeist ref fill <refId> --value "user@example.com"
```

Ref caveats:

- refs are scoped to `tabId + frameId`
- refs are in-memory only
- navigation invalidates refs
- stale or ambiguous refs should fail explicitly instead of acting on weak matches

### Frame inspection

Use frame commands before targeting iframe content:

```bash
shuvgeist frame list --json
shuvgeist frame tree --json
```

Then pass `--frame-id` to supported commands such as:

- `snapshot`
- `locate`
- `ref click`
- `ref fill`
- `eval`

Also pass `--tab-id` when the active tab is not the one you want.

## Observability and power-user surface

### Network capture

Use network capture when you need request metadata, response bodies, or curl reproduction:

```bash
shuvgeist network start
shuvgeist network list --json
shuvgeist network get <requestId> --json
shuvgeist network body <requestId> --json
shuvgeist network curl <requestId> --json
shuvgeist network curl <requestId> --include-sensitive --json
shuvgeist network stats --json
shuvgeist network clear
shuvgeist network stop
```

Important:

- capture is explicit and per tab
- capture continues until `network stop`
- storage is bounded and in-memory
- curl export redacts sensitive headers by default
- `network get`, `network body`, and `network curl` are sensitive bridge capabilities

Typical pattern:

1. `network start`
2. trigger the page action with `navigate`, `repl`, `ref click`, or user interaction
3. `network list --json`
4. inspect or export the interesting request
5. `network stop`

### Device emulation

Use device emulation to test responsive behavior or mobile-only flows:

```bash
shuvgeist device emulate --preset iphone-14-pro --json
shuvgeist device emulate --width 390 --height 844 --dpr 3 --mobile --touch --user-agent "..."
shuvgeist device reset
```

This is sticky per tab until reset.

### Performance metrics and trace capture

Use perf commands when you need timing data or a bounded trace:

```bash
shuvgeist perf metrics --json
shuvgeist perf trace-start --auto-stop 10000 --json
shuvgeist perf trace-stop --json
```

Use `perf metrics` for fast one-shot data. Use trace capture for heavier debugging where raw events matter more than a quick summary.

## Targeting flags

Most bridge commands now support explicit target routing:

```bash
--tab-id <id>
--frame-id <id>
```

Use them for:

- `eval`
- `snapshot`
- `locate`
- `ref click`
- `ref fill`
- `frame list`
- `frame tree`
- `network ...`
- `device ...`
- `perf ...`

Do not assume the OS-focused Chrome window is the correct target. Prefer explicit IDs when working across multiple tabs or frames.

## JSON output

Prefer `--json` whenever the output will feed another tool or a follow-up programmatic step:

```bash
shuvgeist status --json
shuvgeist tabs --json
shuvgeist snapshot --json
shuvgeist locate role button --name "Checkout" --json
shuvgeist network list --json
shuvgeist perf metrics --json
```

## Timeouts

Override timeouts on long-running operations:

```bash
shuvgeist workflow run --file workflow.json --timeout 10m
shuvgeist repl -f scrape.js --timeout 5m
shuvgeist select "Pick an element" --timeout none
shuvgeist perf trace-start --timeout 2m
```

## Exit codes

| Code | Meaning | Action |
|------|---------|--------|
| 0 | Success | Continue |
| 1 | Command/runtime error | Inspect the returned error |
| 2 | No extension connected | User needs to open the sidepanel |
| 3 | Auth/configuration/network error | Check token, URL, or server status |

## Configuration

Config is resolved in this order:

1. CLI flags: `--token`, `--url`, `--host`, `--port`
2. Environment: `SHUVGEIST_BRIDGE_TOKEN`, `SHUVGEIST_BRIDGE_URL`, `SHUVGEIST_BRIDGE_HOST`, `SHUVGEIST_BRIDGE_PORT`
3. Config file: `~/.shuvgeist/bridge.json`

## Recommended operating patterns

### Robust semantic interaction

```bash
shuvgeist snapshot --json
shuvgeist locate role button --name "Sign in" --json
shuvgeist ref click <refId>
```

Use this instead of guessing CSS selectors when page structure is unstable.

### Frame-aware interaction

```bash
shuvgeist frame tree --json
shuvgeist snapshot --frame-id 12 --json
shuvgeist locate label "Search" --frame-id 12 --json
shuvgeist ref fill <refId> --value "query" --frame-id 12
```

### Capture API traffic around a user flow

```bash
shuvgeist network start
shuvgeist ref click <submitRef>
shuvgeist network list --json
shuvgeist network curl <requestId> --json
shuvgeist network stop
```

### Workflow-driven scraping

```bash
shuvgeist workflow run --file workflow.json --arg category=boots --json
```

Use this when the flow is deterministic and you want one bridge request to own the whole run.

### Responsive reproduction

```bash
shuvgeist device emulate --preset pixel-7
shuvgeist navigate "https://example.com/mobile-flow"
shuvgeist screenshot --out /tmp/mobile.webp
shuvgeist device reset
```

### Performance debugging

```bash
shuvgeist perf metrics --json
shuvgeist perf trace-start --auto-stop 15000
# reproduce the issue
shuvgeist perf trace-stop --json
```

## Decision rules

- Use `repl` when you already know the DOM operations you need.
- Use `eval` when the data only exists in MAIN world.
- Use `snapshot` + `locate` + `ref` when selectors are unknown or likely fragile.
- Use `frame list/tree` before touching iframe content.
- Use `workflow` when multiple deterministic steps should happen in one request.
- Use `network` when the browser request/response layer matters more than the rendered DOM.
- Use `device` when layout or behavior depends on viewport/touch/user-agent.
- Use `perf` when timing or trace data matters.
