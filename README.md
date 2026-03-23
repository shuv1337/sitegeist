<p align="center">
  <img src="media/hero.png" alt="Shuvgeist" width="400">
</p>

Shuvgeist is a browser automation extension with CLI bridge automation, WebP screenshot optimization, and additional model support.

Shuvgeist is an AI assistant that lives in your browser sidebar. Built for collaboration, not autonomy theater. You guide, it executes. It can automate repetitive web tasks, extract data from any website, navigate across pages, fill out forms, compare products, compile research, and transform what it finds into documents, spreadsheets, or whatever you need.

Works on any website through a Chrome/Edge side panel, using the AI provider of your choice. Bring your own API key or log in with an existing subscription (Anthropic Claude, OpenAI/ChatGPT, GitHub Copilot, Google Gemini, MiniMax). Your data stays on your machine.

## Project Highlights

See [CHANGELOG.md](CHANGELOG.md) for the full list. Key additions in this repo:

- **CLI-to-extension bridge** — external CLI agents can control the browser via `shuvgeist` commands
- **Cookie bridge access** — `shuvgeist cookies` can read current-site cookies, including HttpOnly, when debugger mode is enabled
- **WebP screenshot pipeline** — 95% smaller images for token-efficient LLM workflows
- **Bridge settings tab** — configure and monitor the bridge connection from the sidepanel
- **Self-hosted CORS proxy** — Docker-ready proxy server in `proxy/`
- **MiniMax M2.7 models** — additional provider support
- **Local CORS via declarativeNetRequest** — merged upstream; no external proxy needed for OAuth
- **Architecture docs** — [ARCHITECTURE.md](ARCHITECTURE.md) for codebase orientation

## Download & Install

### Extension

1. Clone and build (see [Development](#development) below), or download a release
2. Open `chrome://extensions/` or `edge://extensions/`
3. Enable Developer mode
4. Click Load unpacked → select `dist-chrome/`
5. Click "Details" on the Shuvgeist extension and enable:
   - **Allow user scripts**
   - **Allow access to file URLs**
6. Set site access to **On all sites**

Requires Chrome 141+ or Edge equivalent.

### CLI

The CLI is built alongside the extension and provides terminal access to browser automation.

```bash
# Build the CLI
npm run build:cli

# Link it globally (optional, for using `shuvgeist` anywhere)
npm link
```

After linking, the `shuvgeist` command is available system-wide. Without linking, run it directly:

```bash
node dist-cli/shuvgeist.mjs --help
```

## CLI Bridge

The bridge lets external tools (Pi, Claude Code, coding agents, scripts) control your browser through the Shuvgeist sidepanel. Architecture: `CLI → Bridge Server (WebSocket relay) → Extension Sidepanel`.

When sensitive browser data access is enabled in the Bridge settings, the bridge also exposes debugger-backed commands like `shuvgeist eval` and `shuvgeist cookies`.

### Quick start

**1. Start the bridge server:**

```bash
shuvgeist serve
```

On first run it generates a token and saves it to `~/.shuvgeist/bridge.json`. The server listens on `0.0.0.0:19285` by default.

**2. Connect the extension:**

Open the sidepanel → Settings → Bridge tab. Enable the bridge and paste the token. The URL defaults to `ws://127.0.0.1:19285/ws`. A green dot in the header confirms the connection.

**3. Run commands:**

```bash
# Check connection
shuvgeist status

# Navigate
shuvgeist navigate "https://example.com"
shuvgeist navigate "https://github.com" --new-tab

# List and switch tabs
shuvgeist tabs
shuvgeist switch <tabId>

# Take a screenshot (WebP, ~60KB)
shuvgeist screenshot --out page.webp

# Run JavaScript in the page
shuvgeist repl 'return await browserjs(() => document.title)'

# Run JS from a file
shuvgeist repl -f scrape.js --write-files ./output

# DevTools Protocol eval (requires sensitive browser data access in Bridge settings)
shuvgeist eval "document.title"

# Read cookies for the current site, including HttpOnly (requires sensitive browser data access in Bridge settings)
shuvgeist cookies

# Interactive element picker
shuvgeist select "Click the login button"
```

### Configuration

The CLI reads config from (in priority order):

1. Command-line flags (`--token`, `--url`, `--host`, `--port`)
2. Environment variables (`SHUVGEIST_BRIDGE_TOKEN`, `SHUVGEIST_BRIDGE_URL`, etc.)
3. Config file at `~/.shuvgeist/bridge.json`

### JSON output

All commands support `--json` for machine-readable output, useful for scripting and agent integration:

```bash
shuvgeist tabs --json
shuvgeist screenshot --json  # returns base64 dataUrl
shuvgeist cookies --json
```

### Exit codes

| Code | Meaning |
|------|---------|
| 0 | Success |
| 1 | Command/runtime error |
| 2 | No extension target connected |
| 3 | Auth/configuration/network error |

### systemd service

To keep the bridge running persistently on this machine, install the provided user unit:

```bash
install -Dm644 systemd/shuvgeist-bridge.service ~/.config/systemd/user/shuvgeist-bridge.service
systemctl --user daemon-reload
systemctl --user enable --now shuvgeist-bridge.service
```

Check status with:

```bash
systemctl --user status shuvgeist-bridge.service
```

Restart after bridge/CLI changes with:

```bash
systemctl --user restart shuvgeist-bridge.service
```

### LAN operation

The bridge supports multi-host setups on a trusted local network:

```bash
# Bridge server on host A
shuvgeist serve --host 0.0.0.0

# CLI on host B
shuvgeist status --host 192.168.1.100 --token <token>
```

Set the extension's bridge URL to `ws://<bridge-host-ip>:19285/ws`.

> **V1 bridge traffic is unencrypted. Use only on a trusted local network.**

## Development

Clone this repo plus its sibling dependencies into the same parent directory:

```
parent/
  mini-lit/          # https://github.com/shuv1337/mini-lit
  pi-mono/           # https://github.com/shuv1337/pi-mono
  shuvgeist/         # this repo
```

Install dependencies in each repo:

```bash
(cd ../mini-lit && npm install)
(cd ../pi-mono && npm install)
npm install
```

`npm install` sets up the Husky pre-commit hook automatically.

Start all dev watchers (mini-lit, pi-mono, extension, marketing site):

```bash
./dev.sh
```

To run only the extension watcher:

```bash
npm run dev
```

### Building

```bash
npm run build          # Extension → dist-chrome/
npm run build:cli      # CLI → dist-cli/shuvgeist.mjs
```

### Loading the extension

1. Open `chrome://extensions/` or `edge://extensions/`
2. Enable Developer mode
3. Click Load unpacked → select `dist-chrome/`
4. Enable **Allow user scripts** and **Allow access to file URLs** in extension details

The extension hot-reloads when the dev watcher rebuilds.

### First run

On first launch, Shuvgeist prompts you to connect at least one AI provider. You can log in with a subscription or enter an API key. CORS for OAuth is handled locally via declarativeNetRequest rules — no proxy needed.

## Checks

```bash
./check.sh
```

Runs formatting, linting, and type checking for the extension and the `site/` subproject. The Husky pre-commit hook runs the same checks before each commit.

## Agent Skill

A [Pi coding agent](https://github.com/shuv1337/pi-mono) skill for Shuvgeist is included in `skills/shuvgeist/`. To activate it, symlink or copy it to your skills directory:

```bash
ln -s $(pwd)/skills/shuvgeist ~/.pi/agent/skills/shuvgeist
# or for OpenClaw/Shuvbot:
ln -s $(pwd)/skills/shuvgeist ~/skills/shuvgeist
```

The skill teaches coding agents how to use the `shuvgeist` CLI for browser automation.

## Releasing

```bash
./release.sh patch   # 1.0.0 -> 1.0.1
./release.sh minor   # 1.0.0 -> 1.1.0
./release.sh major   # 1.0.0 -> 2.0.0
```

Bumps the version in `static/manifest.chrome.json`, commits, tags, and pushes. GitHub Actions builds the extension and creates a release.

## Updating the website

```bash
cd site && ./run.sh deploy
```

Requires SSH access to `slayer.marioslab.io`.

## License

AGPL-3.0. See [LICENSE](LICENSE).
