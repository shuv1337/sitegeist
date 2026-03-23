---
name: shuvgeist
description: "Control Chrome/Edge browser via the Shuvgeist CLI bridge. Navigate pages, list/switch tabs, run JavaScript in page context, take screenshots, and pick elements. Use when the user asks to browse a site, scrape a page, take a screenshot, interact with a web page, automate browser tasks, or control Chrome/Edge."
---

# Shuvgeist Browser Automation

Control a Chrome/Edge browser through the Shuvgeist extension sidepanel using the `shuvgeist` CLI.

## Prerequisites

The bridge requires three components running:

1. **Extension** — Shuvgeist loaded in Chrome/Edge with the sidepanel open
2. **Bridge server** — `shuvgeist serve` (WebSocket relay on port 19285)
3. **CLI** — `shuvgeist` commands from the terminal

The token is stored in `~/.shuvgeist/bridge.json`. The extension must have the bridge enabled in Settings > Bridge with a matching token.

## Check connection

Always verify the bridge is connected before running commands:

```bash
shuvgeist status
```

If the extension is not connected (exit code 2), the user needs to open the sidepanel.

## Commands

### Navigate

```bash
# Navigate the active tab
shuvgeist navigate "https://example.com"

# Open in a new tab
shuvgeist navigate "https://example.com" --new-tab
```

### Tabs

```bash
# List all tabs
shuvgeist tabs --json

# Switch to a specific tab by ID
shuvgeist switch <tabId>
```

### Screenshot

Screenshots are encoded as WebP (~60KB per capture). Use `--out` to save to a file, or `--json` to get the base64 dataUrl.

```bash
# Save to file
shuvgeist screenshot --out /tmp/page.webp

# Get as JSON (for programmatic use)
shuvgeist screenshot --json

# Limit width
shuvgeist screenshot --out /tmp/page.webp --max-width 800
```

### Run JavaScript (REPL)

The REPL executes code in a sandboxed environment. Use `browserjs()` to run code in the actual page context:

```bash
# Get page title
shuvgeist repl 'return await browserjs(() => document.title)'

# Scrape data from the page
shuvgeist repl 'return await browserjs(() => {
  return Array.from(document.querySelectorAll("h2")).map(h => h.textContent)
})'

# Run from a file
shuvgeist repl -f scrape.js

# Write returned files to a directory
shuvgeist repl -f export.js --write-files ./output
```

Important: code inside `browserjs()` runs in the page. Code outside it runs in the extension sandbox.

### Eval (DevTools Protocol)

Requires sensitive browser data access enabled in the Bridge settings. Evaluates code directly via Chrome DevTools Protocol:

```bash
shuvgeist eval "document.title"
```

### Cookies

Requires sensitive browser data access enabled in the Bridge settings. Reads all cookies for the current site, including HttpOnly cookies.

Note: this requires the extension manifest to include the `cookies` permission and the unpacked extension to be reloaded after updating.

```bash
shuvgeist cookies
```

### Select element

Opens an interactive element picker in the browser. The user clicks an element and its details are returned:

```bash
shuvgeist select "Click the login button"
```

This command has no timeout by default — it waits for user interaction.

## JSON output

All commands support `--json` for machine-readable output:

```bash
shuvgeist tabs --json
shuvgeist status --json
shuvgeist repl 'return await browserjs(() => document.title)' --json
```

## Timeouts

Override the default timeout on any command:

```bash
shuvgeist repl 'return await longRunningTask()' --timeout 5m
shuvgeist navigate "https://slow-site.com" --timeout 120s
shuvgeist select "Pick an element" --timeout none
```

## Exit codes

| Code | Meaning | Action |
|------|---------|--------|
| 0 | Success | — |
| 1 | Command/runtime error | Check the error message |
| 2 | No extension connected | User needs to open the sidepanel |
| 3 | Auth/network error | Check token, URL, or server status |

## Configuration

Config is resolved in this order (first wins):

1. CLI flags: `--token`, `--url`, `--host`, `--port`
2. Environment: `SHUVGEIST_BRIDGE_TOKEN`, `SHUVGEIST_BRIDGE_URL`, `SHUVGEIST_BRIDGE_HOST`, `SHUVGEIST_BRIDGE_PORT`
3. Config file: `~/.shuvgeist/bridge.json`

## Common patterns

### Scrape structured data

```bash
shuvgeist navigate "https://news.ycombinator.com"
shuvgeist repl 'return await browserjs(() => {
  return Array.from(document.querySelectorAll(".titleline a"))
    .slice(0, 10)
    .map(a => ({ title: a.textContent, href: a.href }))
})'
```

### Screenshot workflow

```bash
shuvgeist navigate "https://example.com"
shuvgeist screenshot --out /tmp/example.webp
# The screenshot is WebP, ~60KB, readable by all major LLM APIs
```

### Multi-tab workflow

```bash
shuvgeist navigate "https://site-a.com" --new-tab
shuvgeist navigate "https://site-b.com" --new-tab
shuvgeist tabs --json  # get tab IDs
shuvgeist switch <tabId>  # switch between them
```

### Form filling

```bash
shuvgeist repl 'await browserjs(() => {
  document.querySelector("#email").value = "user@example.com";
  document.querySelector("#password").value = "secret";
  document.querySelector("form").submit();
})'
```
