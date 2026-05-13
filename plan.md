# Shuvgeist Unified Plan

This plan consolidates two previously-separate planning documents:

- `PLAN-cli-safe-screencast-recording.md` — replace broken tabCapture-based `shuvgeist record` with a CDP screencast + CLI-side ffmpeg encoding pipeline.
- `PLAN-agent-browser-recon.md` — close capability gaps against `agent-browser` 0.27.0 (doctor, JSON Schema, stable tab labels, cURL cookie import, `chat`, React introspection, vitals, init scripts).

The TTS plan that previously occupied `plan.md` is essentially shipped and now lives at the bottom of this file under "Completed work — TTS overlay (kept for reference)."

> **Do not implement here.** This document is a plan only. Follow-up sessions execute the checkboxes against this plan.

---

## Release map

| Release | Theme | Includes |
|---|---|---|
| **1.1.12** | Recording hotfix | Tier 0 — CDP screencast recording |
| **1.2.0** | agent-browser parity batch | Tier 1 — doctor, JSON Schema, stable tab labels, cURL cookie import |
| **1.3.0** | Headline command | Tier 2.1 — `shuvgeist chat` |
| **1.4.0** | Frontend devtools | Tier 2.2 react introspection P1, 2.3 vitals, 2.4 init scripts |
| **1.5.0+** | Tier 3 promotions | React P2, `pushstate`, network resource-type filter, skill stub/full split |

**Cross-tier sequencing rules:**

1. Tier 0 (recording) ships first. It is a regression fix and unblocks live-test workflows that other tiers depend on for QA. It also forces a bridge protocol bump that Tier 1 piggy-backs on.
2. Tier 1 is one batch; doctor is the gate; the other three can land in parallel.
3. Tier 2.1 (`chat`) is a single deep PR — do not bundle other features with it.
4. Tier 2.2–2.4 share the debugger CDP plumbing and ship together.

---

## Cross-cutting design decisions (apply to every tier)

These decisions span tiers and prevent rework. Lock them before any milestone starts.

### CDC-1. Bridge protocol versioning

Per recon Q5: bump a minor protocol version on each feature that adds new bridge ops/events. Older CLIs talking to newer bridges (or vice versa) must surface a clean error instead of silent breakage.

Versioning is a handshake, not just a constant:

- [x] Add `BRIDGE_PROTOCOL_VERSION` and `BRIDGE_PROTOCOL_MIN_VERSION` to `src/bridge/protocol.ts`.
- [x] Add `protocolVersion` and `appVersion` to `CliRegistration` and `ExtensionRegistration`.
- [x] Add `protocolVersion`, `minProtocolVersion`, `serverVersion`, and extension `{ protocolVersion, appVersion }` fields to `/status` (`BridgeServerStatus`).
- [x] `BridgeServer` rejects missing/unsupported registration versions with a clean `register_result` error such as: `Bridge protocol mismatch: CLI 3, server supports 4-4. Rebuild or restart shuvgeist.`
- [x] CLI compares its local protocol with `/status` before long-running commands and prints the same remediation message.
- [ ] Tests cover: old CLI → new server, new CLI → old/missing-version server, old extension → new server, and mismatched extension/CLI while `/status` still parses.
- [x] Tier 0 adds `record_frame` and recording lease metadata → bump.
- [ ] Tier 1 adds `tabRef`, `cookies.import`, `doctor_probe`/`doctor_status` → bump.
- [ ] Tier 2.1 adds `chat_start`/`chat_stream` → bump.
- [ ] Tier 2.2–2.4 adds `react_tree`/`react_inspect`, `vitals`, `launch.initScripts` → bump.

### CDC-2. Tab targeting unification (`tabId` ↔ `tabRef`)

Tier 1.3 introduces stable string refs (`t1`, `gmail`). Every command that today accepts `--tab-id` must accept the new `--tab <ref|label>` shape **without breaking back-compat**.

- [ ] Extend the existing `TargetedBridgeParams` in `src/bridge/protocol.ts` once, then have all targeted ops extend it:
  ```ts
  export interface TargetedBridgeParams {
    tabId?: number;     // legacy; accepted only from --tab-id
    tabRef?: string;    // 't1', 'gmail'
    windowId?: number;  // optional future/multi-window disambiguation
    frameId?: number;   // existing frame targeting stays here
  }
  ```
- [ ] `applyTargetFlags` in `src/bridge/cli-core.ts` accepts `--tab <value>` and `--tab-id <number>`:
  - `--tab-id 123` → `tabId: 123`.
  - `--tab t1` / `--tab gmail` → `tabRef`.
  - `--tab 123` → reject with the agent-browser teaching error pointing at `tab list` / `tabs --json`.
- [ ] **`record start --tab-id N` and `record start --tab <ref|label>` must both work** — see Tier 0 §0.6 and Tier 1.3.
- [ ] `RecordStartParams`, `ScreenshotParams`, network/perf/device/frame params, snapshot/locate/ref params, and REPL/eval params all use `TargetedBridgeParams` by the end of Tier 1.3.

### CDC-3. Doctor probe set extends as features ship

Each new feature contributes one probe to `shuvgeist doctor` so health visibility never drifts behind shipped surface area.

- [ ] Tier 0: CLI preflight plus a future `doctor` probe contract for `ffmpeg` availability (binary on PATH, version ≥ a sane floor, can encode a 1-frame WebM). The actual `doctor` command lands in Tier 1.1.
- [ ] Tier 1.3: `tab-registry` probe (registry is live, ref allocation works, no orphan refs).
- [ ] Tier 2.1: `chat-runner` probe (offscreen chat runner can start + cleanly stop, pi-agent-core tools register, OAuth tokens resolve).
- [ ] Tier 2.2: `react-devtools-hook` probe (hook installs, doesn't conflict with browser DevTools).
- [ ] Tier 2.3: `web-vitals` probe (web-vitals package present, can attribute on a trivial fixture).
- [ ] Tier 2.4: `init-scripts` probe (registered scripts are reachable, env-var fallbacks parse).

### CDC-4. CHANGELOG accumulation

Each feature adds an entry under `## [Unreleased]` per `AGENTS.md` rules. Tier 0 lands as a fast 1.1.12 release before Tier 1 starts accumulating 1.2.0 entries. **Never edit released sections.** Use sections in this order: `Breaking Changes`, `Added`, `Changed`, `Fixed`, `Removed`.

### CDC-5. Telemetry-first discipline

Per project `AGENTS.md`:

- Every new bridge op and long-lived server lease emits a span with `record.recording_id`-style stable correlation ids.
- Every new probe, chat-runner step, react op, vitals measurement gets logs + latency.
- Raw frame bytes, raw spoken text, raw cookie values, raw model output: **never logged**. Only sizes, hashes (where useful), counts, durations, outcomes, error class/message.
- Validate end-to-end through Maple Ingest → OTEL collector → Tinybird before any milestone is declared complete.

### CDC-6. GitNexus impact analysis before edits

Per `AGENTS.md`/`gitnexus` rules:

- [ ] Run `gitnexus_impact` upstream on every symbol named in the per-tier "Files" tables before editing it. Capture the blast radius in the PR description.
- [ ] Run `gitnexus_detect_changes()` before each commit.
- [ ] HIGH/CRITICAL risk: pause and notify the user.
- [ ] If the GitNexus index is stale, run `npx gitnexus analyze`; if it fails, record the failure and compensate with direct code inspection before editing.

### CDC-7. Sibling skill mirroring

Whenever `skills/shuvgeist/SKILL.md` is updated, mirror to `~/repos/shuvbot-skills/shuvgeist/SKILL.md` in the same change. Recon's three structural moats (user-visible + interruptible, real session + auth, audio + OAuth) stay in the SKILL.md trigger text.

### CDC-8. Build/check gate after every milestone

```bash
./check.sh        # biome + tsc (both configs) + unit + integration + site checks
npm run build     # rebuilds dist-chrome/ when extension UI/runtime changes
npm run build:cli # rebuilds dist-cli/ when CLI bridge code changes
```

The bridge bootstrap path lives in `node_modules/.bin/tsx src/bridge/cli.ts serve …` — see `AGENTS.md`. Verify the bridge restart path still works after any change to `src/bridge/cli.ts` or `src/bridge/launcher.ts`.

---

## Tier 0 — CDP screencast recording (target: 1.1.12 hotfix)

### Goal

Replace `chrome.tabCapture.getMediaStreamId` with `Page.startScreencast` so CLI-started recording works on authenticated tabs (the live failure mode was Chrome's activeTab invocation rule on `x.com`).

```bash
shuvgeist record start --out /tmp/x-record.webm --tab-id <id> --max-duration 18s --json
```

This must succeed on an authenticated open `x.com` tab without the user clicking the toolbar icon first.

### Files touched

| Area | Files |
|---|---|
| Recording state machine | `src/tools/recording-tools.ts` |
| Background routing | `src/background.ts` |
| Offscreen cleanup | `src/offscreen.ts` (delete recording-specific code; keep TTS intact) |
| Bridge protocol | `src/bridge/protocol.ts`, `src/bridge/internal-messages.ts` |
| Bridge server forwarding / leases | `src/bridge/server.ts` |
| Debugger ownership | `src/tools/helpers/debugger-manager.ts` (detach callback API only; HIGH impact) |
| CLI surface | `src/bridge/cli.ts`, `src/bridge/cli-core.ts` |
| New CLI encoder | `src/bridge/recording/ffmpeg-encoder.ts` |
| Browser command dispatch | `src/bridge/browser-command-executor.ts` |
| Tests | `tests/unit/tools/recording-tools.test.ts` (rewrite), `tests/unit/bridge/recording/ffmpeg-encoder.test.ts` (new), `tests/unit/bridge/server-recording-lease.test.ts` (new), CLI parser tests |
| Validation | `package.json`, `static/manifest.chrome.json`, `AGENTS.md` (remove tabCapture caveat), `CHANGELOG.md` |

### Target architecture

1. CLI verifies `ffmpeg` is on PATH before sending `record_start`.
2. CLI opens websocket → `record_start` with target tab and recording params.
3. Server records a long-lived recording lease after successful `record_start` (`cliConnectionId`, `recordingId`, `tabId`) even though the request itself returns immediately.
4. Background resolves the tab, acquires a debugger session via the shared `DebuggerManager` with owner `record-screencast:<tabId>`, enables `Page` domain, calls `Page.startScreencast`.
5. Extension forwards every `Page.screencastFrame` as a bridge `record_frame` event (JPEG, base64); acks each frame with `Page.screencastFrameAck`.
6. CLI normalises variable-rate frames to a fixed FPS and pipes JPEG bytes into ffmpeg → WebM at `--out`.
7. Extension stops on explicit `record_stop`, `max-duration`, hard byte ceiling, tab closure, debugger detach, or CLI disconnect.
8. On CLI disconnect/crash, server uses the lease to send a synthetic `record_stop` to the extension and releases the lease.
9. CLI closes ffmpeg stdin, waits for encoder, validates output, prints summary (`recordingId`, frame count, source bytes, encoded size, outcome).

### Why CLI-side encoding

| Option | Decision |
|---|---|
| Extension/offscreen WebCodecs encoding | Defer (browser muxing/WebCodecs complexity) |
| **CLI-side `ffmpeg`** | **Chosen for first pass** — robust, available, keeps extension focused on capture |
| Pure JS Node WebM encoding | Not first pass (perf risk) |

### Protocol changes

Add to `BridgeEventType`:

```ts
| "record_frame"
| "record_chunk" // keep during transition, remove in 1.2.x
```

```ts
export interface RecordFrameEventData {
  recordingId: string;
  tabId: number;
  seq: number;
  format: "jpeg" | "png";
  dataBase64: string;
  capturedAtMs: number;
  metadata?: {
    timestamp?: number;
    deviceWidth?: number;
    deviceHeight?: number;
    pageScaleFactor?: number;
    offsetTop?: number;
    scrollOffsetX?: number;
    scrollOffsetY?: number;
  };
  final?: boolean;
  summary?: RecordStopResult;
}

export interface RecordStartParams extends TargetedBridgeParams {
  // (TargetedBridgeParams introduced cross-tier; until Tier 1.3 lands, keep tabId here only)
  maxDurationMs?: number;
  videoBitsPerSecond?: number;
  mimeType?: string;          // 'video/webm' | 'video/webm;codecs=vp8' | 'video/webm;codecs=vp9'
  fps?: number;               // default 12
  quality?: number;           // default 70 (JPEG)
  maxWidth?: number;          // default 1280
  maxHeight?: number;         // unset (let CDP scale by width)
  everyNthFrame?: number;     // default 1
}

export interface RecordStopResult {
  ok: true;
  recordingId: string;
  tabId: number;
  startedAt: string;
  endedAt: string;
  durationMs: number;
  mimeType: string;
  sizeBytes: number;           // source frame bytes (back-compat)
  sourceBytes?: number;
  encodedSizeBytes?: number;   // CLI-filled after ffmpeg finish
  chunkCount: number;          // back-compat alias for frameCount
  frameCount?: number;
  outcome: RecordOutcome;
}
```

New defaults in `BridgeDefaults`:

```ts
RECORD_DEFAULT_FPS: 12,
RECORD_DEFAULT_JPEG_QUALITY: 70,
RECORD_DEFAULT_MAX_WIDTH: 1280,
RECORD_MAX_FPS: 30,
RECORD_MIN_FPS: 1,
```

Server-side lease metadata (internal, not public protocol):

```ts
interface ActiveRecordingLease {
  cliConnectionId: string;
  recordingId: string;
  tabId: number;
  startedAt: number;
}
```

### Milestones

#### 0.1 Safety prep

- [x] `git status --short` — review pre-existing diff on `recording-tools.ts`, `background.ts`, `AGENTS.md`, `CHANGELOG.md`, and the test file. Decide which interim tabCapture-fallback changes to keep vs. supersede.
- [x] Run `gitnexus_impact` on: `RecordingTools`, `cmdRecord`, `BridgeEventType`, `RecordStartParams`, `RecordStopResult`, `DebuggerManager`, and any new debugger helper symbols.
- [x] Treat `DebuggerManager` as HIGH risk unless a fresh impact report proves otherwise; isolate its change to a small detach-callback API and test existing network/perf/device/debugger users.
- [x] If GitNexus analysis fails because the index is stale/broken, record the exact failure and do direct code inspection of all affected callers before editing.
- [x] If HIGH/CRITICAL, surface to user before continuing.

#### 0.2 Protocol additions, compatibility handshake, and recording leases

- [x] Add `record_frame` to `BridgeEventType`. Keep `record_chunk` for one minor as legacy alias.
- [x] Add `RecordFrameEventData`, extend `RecordStartParams`, extend `RecordStopResult` / `RecordStatusResult` with `sourceBytes`, `encodedSizeBytes`, `frameCount`.
- [x] Add the five defaults above to `BridgeDefaults`.
- [x] Implement CDC-1 protocol handshake fields in `src/bridge/protocol.ts`, `src/bridge/server.ts`, `src/bridge/extension-client.ts`, and `src/bridge/cli.ts` before introducing incompatible event behavior.
- [x] `src/bridge/server.ts`: allow `record_frame` and legacy `record_chunk` only when active capabilities include `record_start`.
- [x] `src/bridge/server.ts`: create an `activeRecordingLeases` map after a successful `record_start` response, keyed by CLI connection and `recordingId`.
- [x] `src/bridge/server.ts`: clear leases on final `record_frame` / legacy `record_chunk` summary, explicit `record_stop`, extension disconnect, and CLI disconnect.
- [x] `src/bridge/server.ts`: on CLI disconnect with active recording leases, send a synthetic `record_stop` request to the active extension so debugger sessions are released even if the CLI crashes after `record_start` returned.
- [ ] Tests cover lease creation, final-summary cleanup, explicit stop cleanup, extension disconnect cleanup, and CLI disconnect synthetic stop.

#### 0.3 Debugger-based RecordingTools

Replace tabCapture internals in `src/tools/recording-tools.ts`:

- [x] First add a minimal `DebuggerManager` detach callback API, e.g. `addDetachListener(tabId, listener): () => void`, without changing existing acquire/release semantics.
- [x] Ensure detach callbacks run before tab state deletion and include `{ tabId, reason }`; listener errors must be caught/logged and must not break other debugger users.
- [ ] Add focused tests for `DebuggerManager` detach callbacks and regression tests for existing event listeners.
- [x] Inject `DebuggerManager` via `RecordingToolsOptions`.
- [x] Remove `ensureOffscreenDocument`, `getOffscreenTabId`, `sendToOffscreen` dependencies.
- [x] Rename `emitRecordChunk` → `emitRecordFrame` once protocol lands.
- [x] Add fields: `owner`, `removeListener?`, `frameCount`, `sourceBytes`, `format`, `fps`, `quality`, `maxWidth?`, `maxHeight?`, `screencastActive`.
- [ ] `start()`:
  - [x] `resolveTabTarget({ windowId, tabId })`; protected-URL rejection (debugger-specific wording).
  - [x] One-recording-per-tab rejection.
  - [x] Drop the tabCapture-specific "active tab required" check after live testing confirms `Page.startScreencast` doesn't need it.
  - [x] Acquire debugger with owner `record-screencast:<tabId>`, ensure `Page` domain, register listener **before** starting screencast.
  - [x] Call `Page.startScreencast` with `{ format: "jpeg", quality, maxWidth, maxHeight, everyNthFrame }`.
  - [x] Start max-duration timer **after** screencast succeeds.
  - [x] Return `RecordStartResult` immediately.
- [x] Listener: only `Page.screencastFrame`. Validate `params.data` (string) + `params.sessionId` (number). Always `Page.screencastFrameAck`. Increment `frameCount` + `sourceBytes` by base64 byte length. Emit `record_frame`. Stop with `stopped_max_bytes` at `BridgeDefaults.RECORD_HARD_MAX_BYTES`.
- [x] `stopRecording()`: `Page.stopScreencast` once → remove listener → release debugger owner → emit final `record_frame` with summary.
- [x] `forceStop()` / debugger-detach: idempotent listener removal + release; `lastError` and `stopped_error` outcome.

#### 0.4 Offscreen recording cleanup

After 0.3 passes tests, delete recording-specific code from `src/offscreen.ts`:

- [x] Remove the `bridge-record-*`, `record-chunk`, `record-error`, `record-stopped` handlers.
- [x] Keep all TTS offscreen code untouched (see ownership contract in the TTS section).
- [x] Remove `getOffscreenDocumentTabId()` in `src/background.ts` if unused.
- [x] Remove `USER_MEDIA` from `getOffscreenDocumentReasons()` if no remaining offscreen feature needs it; keep `BLOBS` only if TTS still needs blob/object URL support.
- [x] Remove the `tabCapture` manifest permission from `static/manifest.chrome.json` if no other feature still uses it.
- [x] Simplify `getRecordingTools()` to inject `windowId`, `debuggerManager: sharedDebuggerManager`, `emitRecordFrame`, and `telemetry`.
- [x] Update comments throughout: "tabCapture recorder" → "debugger screencast recorder".

#### 0.5 CLI ffmpeg encoder

New module `src/bridge/recording/ffmpeg-encoder.ts`:

- [x] Static imports only.
- [x] `assertFfmpegAvailable()` — `spawnSync('ffmpeg', ['-version'])` with short timeout. On failure:

  ```
  shuvgeist record requires ffmpeg for debugger screencast encoding. Install ffmpeg or add it to PATH.
  ```

- [x] `FfmpegWebmEncoder` with `start`, `pushFrame`, `finish`, `abort`.
- [x] Fixed-FPS frame duplication keyed to `capturedAtMs` and final `endedAtMs` so static pages still yield a full-length video.
- [x] Bitrate default `2_500_000` when `--video-bitrate` unset.
- [x] VP8 → `libvpx`; VP9 / generic WebM → `libvpx-vp9`.
- [ ] Reference args:

  ```
  ffmpeg -hide_banner -loglevel error -y \
    -f image2pipe -framerate 12 -vcodec mjpeg -i pipe:0 \
    -an -c:v libvpx-vp9 -b:v 2500000 -pix_fmt yuv420p output.webm
  ```

- [x] Collect stderr; surface on failure. Stat output after finish for `encodedSizeBytes`.

#### 0.6 CLI wiring

- [x] `src/bridge/cli-core.ts` and `src/bridge/cli.ts` argument parsing: add `--fps`, `--quality`, `--max-width`, `--max-height`. Validate numeric ranges (FPS within `RECORD_MIN_FPS`–`RECORD_MAX_FPS`, quality 1–100, dimensions positive). Validate `--mime-type` against the WebM-only list (`video/webm`, `video/webm;codecs=vp8`, `video/webm;codecs=vp9`).
- [ ] `src/bridge/cli.ts`:
  - [x] `cmdRecord()` calls `assertFfmpegAvailable()` before opening the websocket.
  - [x] On `record_start` success, start the encoder.
  - [x] On each `record_frame`: decode base64, `encoder.pushFrame`.
  - [x] On final frame: `encoder.finish` → fold `encodedSizeBytes` into summary.
  - [x] No more `createWriteStream(outPath)` in `cmdRecord`.
  - [x] SIGINT: `record_stop` → wait for summary → finish encoder if frames exist. WebSocket close mid-recording: abort encoder, exit code 3.
  - [x] Update `isRecordChunkEvent` → `isRecordFrameEvent` (or support both during transition).
  - [x] Update `printRecordStopSummary` to print `Frames`, `Source bytes`, `Encoded size`; JSON includes `out` and `encodedSizeBytes`.
- [x] CLI help string:

  ```
  shuvgeist record start --out file.webm [--tab-id N | --tab ref] [--max-duration 30s]
                         [--fps N] [--quality N] [--max-width N]
                         [--video-bitrate N] [--mime-type video/webm;codecs=vp9]
  ```

- [ ] `--tab-id` stays for back-compat; `--tab` arrives with Tier 1.3.

#### 0.7 Tests

`RecordingTools` (rewrite `tests/unit/tools/recording-tools.test.ts`):

- [x] Mock `DebuggerManager`; remove tabCapture mocks.
- [x] `start()` sends `Page.startScreencast` with expected defaults.
- [x] Duplicate-recording rejection.
- [x] `record_status` exposes frame/source byte stats, never frame bytes.
- [x] `Page.screencastFrame` handling emits `record_frame`, increments counters, acks.
- [x] Max-duration → `Page.stopScreencast` → `stopped_max_duration`.
- [x] Tab closure → `stopped_tab_closed`.
- [x] Debugger detach/error → `stopped_error`.
- [x] Disallowed schemes rejected.

Server/bridge lifecycle:

- [ ] Successful `record_start` creates a server lease.
- [ ] Final summary clears the lease.
- [ ] Explicit `record_stop` clears the lease.
- [ ] CLI disconnect after `record_start` sends synthetic `record_stop` and clears the lease.
- [ ] Protocol mismatch registration is rejected cleanly.

Debugger manager:

- [ ] Detach callbacks fire before state deletion and do not break regular debugger event listeners.
- [ ] Existing network/perf/device/debugger-manager tests still pass.

CLI encoder (new `tests/unit/bridge/recording/ffmpeg-encoder.test.ts`):

- [ ] Frame-duplication scheduler (no real ffmpeg).
- [ ] Mime-type → ffmpeg codec mapping.
- [ ] Missing ffmpeg → clear error.
- [ ] Optional ffmpeg-gated integration test: encode 2–3 synthesised JPEG frames to WebM.

CLI parser:

- [ ] `--fps`, `--quality`, `--max-width` accepted with bounds checks.
- [ ] WebM-only mime validation.

#### 0.8 Build + live validation

- [x] `./check.sh`, `npm run build`, `npm run build:cli`.
- [ ] Reload extension; `shuvgeist status --json` lists `record_start`, `record_stop`, `record_status`, and protocol/app version metadata.
- [ ] Simulate old/new protocol mismatch and verify a clean remediation error.
- [ ] Kill/disconnect the CLI mid-recording and verify the extension releases the debugger session and a later recording on the same tab can start.
- [ ] Smoke on `example.com`:

  ```bash
  shuvgeist navigate https://example.com --new-tab --json
  shuvgeist tabs --json
  shuvgeist record start --out /tmp/example.webm --tab-id <id> --max-duration 5s --json
  file /tmp/example.webm
  ffprobe -hide_banner /tmp/example.webm
  ```

- [ ] X-tab validation — 18 s recording while running benign scroll/feed-switch via `shuvgeist repl --tab-id <id>`. Verify the `Extension has not been invoked for the current page (see activeTab permission)` failure no longer occurs.

#### 0.9 Documentation cleanup

- [x] `CHANGELOG.md` `## [Unreleased]` → `### Changed`: "shuvgeist record now uses CDP `Page.startScreencast` + CLI-side ffmpeg encoding instead of tabCapture; fixes activeTab invocation failure for CLI-started recordings."
- [x] `AGENTS.md`: remove the tabCapture `activeTab` warning paragraph; add a one-liner that recording needs `ffmpeg` on PATH.
- [x] `README.md`: ffmpeg requirement, video-only/no-audio limitation, sensitive-browser-access gate retained.
- [x] `static/manifest.chrome.json`: remove `tabCapture` permission if unused after the migration.
- [x] Delete dead tabCapture fallback code paths.

### Acceptance — Tier 0

- [ ] `shuvgeist record start --out file.webm --tab-id <xTabId> --max-duration 10s --json` succeeds on an authenticated open `x.com` tab from a fresh terminal.
- [ ] Output file is non-empty, recognised as WebM by `file` and `ffprobe`.
- [ ] JSON summary includes recording id, tab id, duration, outcome, frame count, source bytes, encoded size, out path.
- [ ] `record_status --json` reports active recording metadata without frame bytes.
- [ ] `record_stop --json` stops an active recording from a separate CLI invocation.
- [ ] SIGINT during `record start` finalises a playable partial WebM when ≥1 frame captured.
- [ ] CLI crash/disconnect after `record_start` releases the debugger session and does not leave a stuck active recording.
- [ ] Protocol mismatches fail with a clear rebuild/restart remediation.
- [ ] `static/manifest.chrome.json` no longer requests `tabCapture` unless a separate feature still requires it.
- [ ] `./check.sh` passes; `npm run build` + `npm run build:cli` succeed.
- [x] `gitnexus_detect_changes()` reviewed before commit.

### Risks

| Risk | Mitigation |
|---|---|
| Debugger screencast conflicts with perf/network debugger tools | `DebuggerManager` refcounting + unique owners; remove listeners and release on every exit path |
| High frame volume over websocket | JPEG default, 1280 max width, q=70, fps 12, 64 MiB source ceiling, stop on byte ceiling |
| Variable frame cadence breaks duration | CLI duplicates last frame to the fixed FPS using `capturedAtMs` + `endedAtMs` |
| Missing ffmpeg | Preflight check + clear CLI error |
| Static pages yield ≤1 frame | Last-frame duplication until final duration; fail clearly only when zero frames captured |
| Websocket disconnect mid-recording | Server recording lease sends synthetic `record_stop`; CLI aborts encoder; extension releases debugger via stop/detach handling |
| Protocol skew after bridge changes | Registration handshake + `/status` metadata rejects incompatible CLI/server/extension combinations before commands run |
| Protected pages | Disallowed-scheme guard + clear error |

---

## Tier 1 — agent-browser parity batch (target: 1.2.0)

Recon source: `https://files.shuv.me/agent-browser-vs-shuvgeist.html` and `/tmp/agent-browser` (refresh with `git pull`).

### Tier 1 cross-cutting

- Bump bridge protocol version (CDC-1) once for the entire batch.
- `cmdRecord` (Tier 0) gains `--tab` support during Tier 1.3 work — both `--tab-id` and `--tab` accepted.
- Tier 1 CHANGELOG accumulates `### Added` for doctor + schema + tab labels + cookie import.

### 1.1 `shuvgeist doctor`

**Why.** Closes follow-ups from `PLAN-345-resolve-bridge-issues.md`; gives Shuvgeist the same one-shot diagnosis story agent-browser shipped in 0.26.

**Probe set (adapted from agent-browser 0.26):**

| Probe | Shuvgeist-adapted check |
|---|---|
| `environment` | OS, Node ≥ 20, npm presence (pnpm optional), `~/.shuvgeist` writable, **`ffmpeg` on PATH** (added per CDC-3 / Tier 0) |
| `chrome` | Chrome ≥ 141; `--fix` opens download instructions |
| `daemon` | Bridge process running; port reachable; PID file fresh |
| `config` | `~/.shuvgeist/bridge.json` parses; required keys; valid extension id |
| `security` | OAuth tokens not expired; secrets file mode `600`; CORS allowlist sane |
| `providers` | Cheap probe per configured provider (Anthropic `/v1/health`, OpenAI `/models`) |
| `network` | DNS for provider hostnames; outbound HTTPS to AI Gateway |
| `extension` | Extension registered with bridge in last 30 s; manifest version matches CLI version |
| `headless-launch` | `launch --headless --use-default-profile=false` → `about:blank` → snapshot → close (skip with `--quick`) |

**Flags:** `--offline`, `--quick`, `--fix`, `--json`.

**Files:**

- Create: `src/bridge/doctor/index.ts`, `src/bridge/doctor/types.ts`, `src/bridge/doctor/output.ts`, `src/bridge/doctor/fix.ts`.
- Create: `src/bridge/doctor/probes/{environment,chrome,daemon,config,security,providers,network,extension,launch}.ts`.
- Modify: `src/bridge/cli.ts` (register subcommand).
- Modify: `src/bridge/protocol.ts` — add `doctor_probe` / `doctor_status` method types if a probe must run inside the extension.
- Modify: `src/bridge/browser-command-executor.ts` and `src/background.ts` — route extension-only probes (OAuth token resolution, extension manifest version, tab registry, chat runner, React/vitals/init-script future probes).
- Modify: `src/bridge/server.ts` — include protocol/app version metadata in `/status` and expose stale/mismatched extension information.
- Tests: `tests/unit/bridge/doctor/probes.test.ts` (one describe per probe), `tests/integration/bridge/doctor.test.ts` (full pass/fail matrix), `tests/e2e/extension/doctor.e2e.ts` (smoke).

**Probe placement:** host probes run in the CLI process; extension/storage probes run through bridge `doctor_*` methods; server/protocol probes use `/status`. Doctor must not guess extension-only state from host files.

**Probe contract:**

```ts
export type Severity = 'info' | 'warn' | 'error';
export interface ProbeResult { id: string; ok: boolean; severity: Severity; message: string; hint?: string; fix?: () => Promise<{ ok: boolean; message: string }> }
export interface Probe { id: string; description: string; run(opts: ProbeOpts): Promise<ProbeResult | ProbeResult[]> }
export interface ProbeOpts { offline: boolean; quick: boolean; fix: boolean }
```

**Acceptance:**

- [ ] Exit 0 when all probes pass; exit 2 on any error-severity probe.
- [ ] `--json` parses for both pass and fail.
- [ ] `--fix` idempotent across consecutive runs.
- [ ] Version/protocol-mismatched bridge daemon or extension detected and killable/restartable with `--fix` where safe.
- [ ] **`ffmpeg` probe surfaces a clear remediation hint if missing** (joins Tier 0 acceptance).
- [ ] Probe execution: independent probes run in parallel (recon Q4); results emitted in stable order.
- [ ] Doctor never modifies the user's Chrome profile and never transmits secrets.

### 1.2 JSON Schema for `bridge.json`

**Files:**

- Create: `shuvgeist.schema.json` at repo root, draft 2020-12.
- Modify: `src/bridge/settings.ts` — emit `$schema` line when writing `bridge.json` the first time.
- Modify: `site/src/frontend/` — serve `https://shuvgeist.dev/schema.json` (mirror).
- Modify: `README.md` — note `$schema` support.
- Tests: `tests/unit/bridge/settings.test.ts` — generated config validates.

**Constraints:**

- Cover every key actually read by `src/bridge/settings.ts`.
- `description` fields written for humans.
- `examples` for non-obvious values.
- `npm run schema:check` script (add the script and required dev dependency such as `ajv-cli`) fails CI if `settings.ts` / `CliConfigFile` keys drift from schema.

**Acceptance:**

- [ ] `npm run schema:check` passes, including `npx ajv validate -s shuvgeist.schema.json -d ~/.shuvgeist/bridge.json` or an equivalent fixture validation.
- [ ] IntelliJ + VS Code autocomplete when `bridge.json` declares `$schema`.

### 1.3 Stable tab labels (`tab new --label`, `tab <label>`)

**Ownership decision.** The tab registry is extension-owned, because the extension already observes tab lifecycle events and resolves real browser targets. Labels reset on extension reload/browser restart (not on `serve` restart). Store the registry in `chrome.storage.session` so labels survive MV3 service-worker suspension but not browser-session restart.

**Files:**

- Create: `src/bridge/tab-registry.ts`.
- Modify: `src/bridge/protocol.ts` — extend `TargetedBridgeParams` per CDC-2; add tab registry result types; extend `NavigateParams` or add `tab_*` methods for labeled tab create/list/rename/close.
- Modify: `src/bridge/cli-core.ts` — `applyTargetFlags` resolves `--tab <ref|label>`; rejects bare integers with teaching error.
- Modify: `src/bridge/cli.ts` — add `tab new|list|rename|close` while preserving legacy `tabs` and `switch`; `cmdRecord` accepts `--tab`.
- Modify: `src/bridge/browser-command-executor.ts` — resolve `tabRef` before targeted operations.
- Modify: `src/background.ts` — `tabs.onCreated`/`onRemoved`/`onUpdated` feed the extension-owned registry and storage-session persistence.
- Modify: `src/bridge/protocol.ts`, `src/bridge/cli-core.ts`, `src/background.ts` — make `screenshot` a targeted op too (`ScreenshotParams extends TargetedBridgeParams`), because Tier 1 acceptance uses `shuvgeist screenshot --tab gmail`.
- Modify: `src/sidepanel.ts` — show labels in tab picker / tab displays where applicable.
- Modify: `skills/shuvgeist/SKILL.md` + `~/repos/shuvbot-skills/shuvgeist/SKILL.md` — document labels.
- Tests: `tests/unit/bridge/tab-registry.test.ts` (id stability under churn), `tests/integration/bridge/tab-targeting.test.ts` (labels survive cross-command calls), screenshot-targeting tests.

**Tab registry contract:**

```ts
export interface TabHandle { ref: string; label?: string; tabId: number; windowId: number; url?: string; title?: string; createdAt: number; updatedAt: number }
export interface TabRegistry {
  register(tabId: number, windowId: number, label?: string): TabHandle;
  resolve(input: string): TabHandle | undefined;
  list(): TabHandle[];
  remove(tabId: number): void;
  rename(refOrLabel: string, newLabel: string): TabHandle;
  hydrate(handles: TabHandle[]): void;
}
```

**Acceptance:**

- [ ] After opening 5 tabs and closing 2 and 3, refs for 1, 4, 5 are unchanged.
- [ ] `shuvgeist tab new --label gmail https://mail.google.com` creates the tab + label; legacy `shuvgeist tabs --json` still works.
- [ ] `shuvgeist screenshot --tab gmail` works because screenshot is added to the targeted-op matrix.
- [ ] `shuvgeist screenshot --tab 0` rejected with teaching error pointing at `tab list` / `tabs --json`.
- [ ] `shuvgeist record start --tab gmail --out f.webm` works (Tier 0 compatibility).
- [ ] Labels survive MV3 service-worker suspension through `chrome.storage.session`, but reset on extension reload/browser restart.
- [ ] User-facing agent/CLI tab summaries prefer labels/refs over raw `tabId`; raw `tabId` remains available in JSON for debugging/back-compat.

### 1.4 cURL cookie import

**Command grammar:** preserve legacy `shuvgeist cookies` as `cookies get`. Add explicit subcommands:

```bash
shuvgeist cookies get [--url <url>] [--json]
shuvgeist cookies import (--curl <file> | --header <file> | --file <json-file>) --url <url> [--json]
# optional compatibility alias: cookies set -> cookies import
```

`--url` is required for import unless every parsed cookie has enough domain/scheme information to construct a safe URL for `chrome.cookies.set`; ambiguous domain/path input is rejected.

**Files:**

- Create: `src/bridge/cookies/import.ts`, `src/bridge/cookies/parsers/{json,curl,header}.ts`.
- Modify: `src/bridge/cli.ts` / `src/bridge/cli-core.ts` — `cookies get`, `cookies import --curl <file>`, `--header <file>`, `--file <json-file>`; legacy `cookies` maps to get.
- Modify: `src/bridge/protocol.ts` — discriminated `CookiesParams` / `CookieImportParams`.
- Modify: `src/bridge/browser-command-executor.ts` — `cookies get` keeps existing sensitive bridge behavior; `cookies import` performs bulk `chrome.cookies.set` calls with safe URL/domain validation.
- Tests: `tests/unit/bridge/cookies/import.test.ts` (three fixtures + ambiguous fallback), `tests/integration/bridge/cookies.test.ts` (round-trip, invalid domain/url rejection).

**Parser contract:**

```ts
export interface ParsedCookie { name: string; value: string; domain?: string; path?: string; expirationDate?: number; httpOnly?: boolean; secure?: boolean; sameSite?: 'no_restriction' | 'lax' | 'strict' }
export type CookieFormat = 'json' | 'curl' | 'cookie-header';
export interface ImportResult { format: CookieFormat; cookies: ParsedCookie[]; warnings: string[] }
export type CookiesParams =
  | { action?: 'get'; url?: string }
  | { action: 'import'; url?: string; cookies: ParsedCookie[]; sourceFormat: CookieFormat };
export function importCookies(raw: string, hint?: CookieFormat): ImportResult;
```

**Detection (in order, first match wins):**

1. Starts with `[` or `{` → `json`.
2. Contains `curl ` or `--cookie` or `-H 'Cookie:` → `curl`.
3. Contains `=` and `;` and no whitespace before `=` → `cookie-header`.
4. Otherwise reject with "could not detect format; pass `--file` / `--curl` / `--header`".

**Acceptance:**

- [ ] All three fixture formats produce identical `ParsedCookie[]` for the same logical input.
- [ ] Ambiguous input rejected, not silently misparsed.
- [ ] `cookies get` round-trips values just imported via `cookies import --curl`.
- [ ] Import rejects cookies whose URL/domain/sameSite/secure combination cannot be safely passed to `chrome.cookies.set`.

### Tier 1 changelog (preview)

```markdown
## [Unreleased]

### Added

- `shuvgeist doctor` command — probes environment (incl. ffmpeg), Chrome,
  bridge daemon, config, security, providers, network, extension
  registration, and headless launch. Supports `--offline`, `--quick`,
  `--fix`, `--json`.
- JSON Schema for `~/.shuvgeist/bridge.json`, served at
  `https://shuvgeist.dev/schema.json`.
- Stable tab labels via `tab new --label <name>`; refs survive other tabs
  closing and MV3 service-worker suspension. `--tab <ref|label>` accepted
  everywhere targeted operations are supported (including `record start` and
  `screenshot`); bare integers rejected with a teaching error.
- Bulk cookie import via `cookies import --curl <file> --url <url>` with
  auto-detection of JSON, cURL, and Cookie-header formats. Legacy
  `shuvgeist cookies` remains an alias for `cookies get`.
```

---

## Tier 2.1 — `shuvgeist chat` (target: 1.3.0)

The headline command. Real browser, real authenticated sessions.

### Critical reuse

Do **not** reimplement the pi-agent-core agent loop. The sidepanel already runs that loop, but today the setup is embedded in `src/sidepanel.ts` with `ChatPanel`, renderers, UI callbacks, model selection, storage, and runtime-provider wiring. Tier 2.1 must first extract a UI-free runtime factory.

**Prerequisite refactor:** create a shared module such as `src/agent/runtime.ts` / `src/agent/tools-factory.ts` that owns:

- model normalization/default selection and API-key/OAuth token resolution,
- `Agent` construction and event subscription hooks,
- browser tool factory wiring (`NavigateTool`, REPL runtime providers, skills, extract document/image, optional debugger),
- session persistence hooks that sidepanel and offscreen can supply separately.

Sidepanel then becomes a UI frontend over the shared runtime; offscreen chat-runner becomes a headless frontend over the same runtime. Avoid adding new inline dynamic imports while extracting this module.

**Architecture decision:** Option A — terminal frontend talks to a bridge command that runs the shared agent runtime in the extension's offscreen document. Rationale: the OAuth moat (extension-stored Anthropic/OpenAI tokens) is structural; re-implementing token handoff to a Node process discards it. Latency mitigated by streaming.

### Modes

- One-shot: `shuvgeist chat "open my Linear inbox and summarise unresolved issues"`.
- Interactive: `shuvgeist chat` — REPL with `/help`, `/model`, `/clear`, `/exit`.
- Sub-agent: any agent supporting Bash can wrap `shuvgeist chat`.
- Sidepanel chat already exists; `chat --open-sidepanel` deep-links into it.

### Files

- Create: `src/agent/runtime.ts`, `src/agent/tools-factory.ts` (shared UI-free agent setup extracted from `src/sidepanel.ts`).
- Create: `src/bridge/chat/cli.ts`, `src/bridge/chat/session.ts`, `src/bridge/chat/protocol.ts`.
- Create: `src/offscreen/chat-runner.ts` (uses the shared runtime factory, not `ChatPanel`).
- Create: `src/messages/chat-stream.ts`.
- Modify: `src/bridge/cli.ts` — register `chat`.
- Modify: `src/bridge/protocol.ts` — chat params/results; bump version.
- Modify: `src/bridge/browser-command-executor.ts` — route chat ops to offscreen.
- Modify: `src/background.ts` — proxy chat events offscreen ↔ bridge; pin offscreen with `chrome.runtime.connect` for the duration of a chat session (MV3 30 s idle timeout otherwise).
- Modify: `src/offscreen.ts` — register chat-runner; manage runner lifecycle **without** touching `window.__shuvgeistTtsController` (TTS ownership contract still applies).
- Modify: `src/sidepanel.ts` — consume the shared runtime factory and show a passive indicator when chat is running headlessly; no UI hijack.
- Modify: `src/storage/sessions.ts` — chat sessions alongside sidepanel sessions.
- Modify: `skills/shuvgeist/SKILL.md` + sibling.
- Modify: `README.md` — make `chat` the headline command.
- Tests: `tests/unit/bridge/chat/session.test.ts`, `tests/integration/bridge/chat.test.ts` (mock model), `tests/e2e/extension/chat.e2e.ts` (full real-browser run on a captured fixture site).

### Streaming protocol

```ts
export interface ChatStartParams {
  message: string;
  sessionId?: string;
  model?: string;        // default anthropic/claude-sonnet-4.6 via shuvgeist provider preset
  systemPrompt?: string;
  json?: boolean;
}
export type ChatStreamEvent =
  | { type: 'turn-start';   role: 'assistant'; turnId: string }
  | { type: 'text-delta';   turnId: string; text: string }
  | { type: 'tool-call';    turnId: string; toolCallId: string; name: string; input: unknown }
  | { type: 'tool-result';  turnId: string; toolCallId: string; result: unknown }
  | { type: 'turn-end';     turnId: string; usage: { input: number; output: number } }
  | { type: 'session-end';  sessionId: string }
  | { type: 'error';        message: string; code: string };
```

**Verbosity:** quiet (final answer only) / normal (snapshot + tool summary) / verbose (every tool call + result). `--json` prints one event per line.

### Acceptance

- [ ] Sidepanel still passes existing session/tool/model tests after the shared runtime extraction.
- [ ] `shuvgeist chat "ping"` returns text without invoking a tool.
- [ ] `shuvgeist chat "open google and search 'site:rust-lang.org cdp'"` drives the real browser through google.com → results.
- [ ] Ctrl-C in interactive mode cancels in-flight turn cleanly; no orphaned offscreen runner.
- [ ] `shuvgeist chat "…" --json` emits parseable newline-delimited JSON.
- [ ] Same OAuth tokens that power the sidepanel power the CLI; no extra setup.
- [ ] Sub-agent wrapper works (Bash-capable agent calls `shuvgeist chat`).
- [ ] `doctor` `chat-runner` probe (CDC-3) passes.

### Pitfalls

- MV3 offscreen 30 s idle timeout → pin via `chrome.runtime.connect` for the chat session; release on `session-end`.
- Extension must be installed + registered before `chat` runs; surface a doctor-style hint when not.
- Backpressure: flush after every `text-delta` so the terminal stays responsive.
- AI Gateway compatibility (recon Q1): accept `AI_GATEWAY_API_KEY` as last-resort fallback after shuvgeist provider preset resolution.

---

## Tier 2.2–2.4 — frontend devtools (target: 1.4.0)

Bundle these into one minor version because they share the debugger CDP plumbing. Any additional `DebuggerManager` API work remains HIGH-risk: run impact analysis, isolate helper additions, and regression-test network/perf/device/debugger users before landing React/vitals/init-script changes.

### 2.2 React introspection — Phase 1

**Scope (Phase 1):** `react tree`, `react inspect <fiberId>`.
**Phase 2 (deferred to 1.5.0+):** `react renders start|stop`, `react suspense`.

**Files:**

- Create: `src/tools/react/install-hook.ts` — vendored React DevTools hook (MIT; `src/tools/react/LICENSE` + top-level `THIRD_PARTY_LICENSES.md`, recon Q3).
- Create: `src/tools/react/tree.ts`, `src/tools/react/inspect.ts`.
- Create: `src/bridge/protocol-react.ts`.
- Modify: `src/tools/debugger.ts` — add page-context script injection helper if missing.
- Modify: `src/bridge/cli.ts` — `react tree`, `react inspect`.
- Modify: `src/bridge/browser-command-executor.ts` — route to debugger script injection.
- Modify: `src/sidepanel.ts` — expose `react tree` as an agent tool.
- Modify: `src/tools/index.ts` — register react tools (gated on hook presence).
- Modify: `skills/shuvgeist/SKILL.md` + sibling.
- Tests: `tests/unit/tools/react/tree.test.ts` (fixture), `tests/integration/bridge/react.test.ts` (real React app under `tests/fixtures/react-app`, Vite-based).

**Hook ownership:**

- Vendor at `src/tools/react/install-hook.js`, MIT license attribution.
- Inject before page's first React import via CDP runtime — same pattern as agent-browser's `installHook.js`.
- Detect via `window.__REACT_DEVTOOLS_GLOBAL_HOOK__`.
- Keep size < 50 KB minified; strip dev-only logging.

**Acceptance:**

- [ ] `shuvgeist react tree --tab gmail` prints fiber tree JSON.
- [ ] `shuvgeist react inspect <fiberId> --tab gmail` returns props, hooks, state.
- [ ] Hook does not interfere with browser's React DevTools.
- [ ] Doctor `react-devtools-hook` probe (CDC-3) passes.

### 2.3 `vitals`

**Files:**

- Create: `src/tools/vitals/measure.ts`, `src/tools/vitals/types.ts`.
- Modify: `src/bridge/cli.ts` — `vitals [url]`.
- Modify: `src/bridge/protocol.ts` — `VitalsParams`.
- Modify: `src/bridge/browser-command-executor.ts`, `src/tools/index.ts`.
- Modify: `skills/shuvgeist/SKILL.md` + sibling.
- Tests: `tests/unit/tools/vitals/measure.test.ts`, `tests/integration/bridge/vitals.test.ts`.

**Result shape:**

```ts
export interface VitalsResult {
  url: string;
  lcp?: { value: number; unit: 'ms'; rating: 'good' | 'needs-improvement' | 'poor' };
  cls?: { value: number; unit: 'score'; rating: 'good' | 'needs-improvement' | 'poor' };
  ttfb?: { value: number; unit: 'ms'; rating: 'good' | 'needs-improvement' | 'poor' };
  fcp?: { value: number; unit: 'ms'; rating: 'good' | 'needs-improvement' | 'poor' };
  inp?: { value: number; unit: 'ms'; rating: 'good' | 'needs-improvement' | 'poor' };
  reactHydration?: { startedAt: number; finishedAt: number; phaseCount: number };
  measuredAt: number;
}
```

Use the `web-vitals` npm package (vendored, `attribution` build, < 5 KB). React hydration measured only when React is detected.

**Acceptance:**

- [ ] `shuvgeist vitals` measures active tab and prints table.
- [ ] `shuvgeist vitals https://example.com` opens URL, measures, prints.
- [ ] Ratings colour-coded in the terminal (good=green, needs-improvement=amber, poor=red).
- [ ] Doctor `web-vitals` probe (CDC-3) passes.

### 2.4 Init scripts + feature flags

**Files:**

- Create: `src/bridge/init-scripts/registry.ts`, `src/bridge/init-scripts/runner.ts`.
- Modify: `src/bridge/cli.ts` — `--init-script <path>` (repeatable), `--enable <feature>` (repeatable).
- Modify: `src/bridge/launcher.ts` — pass init scripts through `shuvgeist launch`.
- Modify: `src/bridge/protocol.ts` — `LaunchParams.initScripts: string[]; enable: string[]`.
- Modify: `src/bridge/settings.ts` — env vars `AGENT_BROWSER_INIT_SCRIPTS` (compat) + `SHUVGEIST_INIT_SCRIPTS`; `bridge.json` `initScripts` array.
- Modify: `src/storage/skills.ts` — skills register their own built-in init scripts.
- Tests: `tests/unit/bridge/init-scripts/registry.test.ts`, `tests/integration/bridge/init-scripts.test.ts` (script runs before page's own scripts).

**Built-in features (initial set):**

| Flag | Behaviour |
|---|---|
| `react-devtools` | Installs the hook shared with §2.2 |
| `consent-banner-dismiss` | Best-effort dismissal of common cookie banners |
| `viewport-mock-mobile` | Sets DPR + viewport to iPhone defaults pre-load |

**Acceptance:**

- [ ] `shuvgeist launch --enable react-devtools` makes `shuvgeist react tree` work without manual install.
- [ ] `--init-script ./prep.js` runs before any page script; repeatable; order preserved.
- [ ] `SHUVGEIST_INIT_SCRIPTS=./a.js:./b.js shuvgeist launch` equivalent to `--init-script ./a.js --init-script ./b.js`.
- [ ] Doctor `init-scripts` probe (CDC-3) passes.

### Tier 2.2–2.4 changelog (preview)

```markdown
### Added

- `shuvgeist react tree` and `shuvgeist react inspect <fiberId>` — fiber-tree
  introspection backed by a vendored React DevTools hook.
- `shuvgeist vitals` — Core Web Vitals + React hydration phases.
- `--init-script <path>` (repeatable) and `--enable <feature>` (repeatable)
  flags on `shuvgeist launch`. Built-in features: `react-devtools`,
  `consent-banner-dismiss`, `viewport-mock-mobile`. Env-var fallbacks:
  `SHUVGEIST_INIT_SCRIPTS`, `AGENT_BROWSER_INIT_SCRIPTS`.
```

---

## Tier 3 — Tracking only

Promote into a tier when one of these blocks a real user.

| Item | Notes |
|---|---|
| React Phase 2 (`renders`, `suspense`) | Needs CDP performance tracing; defer until Phase 1 lands |
| `pushstate <url>` | SPA client-side nav; today the agent can call `repl history.pushState(...)` |
| `network route --resource-type` filter | Scope HAR captures by CDP resource type |
| Skill stub vs full guide split | Mirror agent-browser's 420-line guide vs 40-line discovery stub when `skills/shuvgeist/SKILL.md` passes ~250 lines |

---

## Out of scope (and why)

- **Headless Rust daemon.** Different DNA; sidepanel + real-browser is the moat.
- **`--engine lightpanda` / alternative engines.** Chrome-only is correct for the extension constraint.
- **Cross-browser support (Firefox, Safari).** Already explicit in `README.md`.
- **Re-implementing pi-agent-core in Rust or Node.** Reuse the sidepanel runtime through the bridge.
- **Standalone dashboard.** Sidepanel is the UI surface; a separate dashboard splits user attention.

---

## Open questions (resolve before each tier starts)

1. **Tier 0:** `Page.startScreencast` active-tab dependency unknown until live-tested. Plan assumes the active-tab check can be dropped after testing; if it can't, keep an opt-in guard and document the limitation before release.
2. **Tier 1.3:** Tab registry is extension-owned; labels persist through MV3 service-worker suspension via `chrome.storage.session` but reset on extension reload/browser restart. This intentionally differs from agent-browser's serve-restart reset semantics.
3. **Tier 2.1:** AI Gateway env var fallback ordering — provider preset wins over `AI_GATEWAY_API_KEY` (recon Q1).
4. **Tier 2.2:** React hook MIT license attribution lives at `src/tools/react/LICENSE` + top-level `THIRD_PARTY_LICENSES.md` (recon Q3).
5. **Tier 1.1:** Doctor probes run network/provider probes in parallel; emit results in stable order (recon Q4).
6. **All tiers:** Bridge protocol minor version bumps per feature; older CLI ↔ newer bridge surfaces a clean error (recon Q5 / CDC-1).

---

## Per-tier validation commands

```bash
# Tier 0
./check.sh
npm run build
npm run build:cli
shuvgeist record start --out /tmp/x.webm --tab-id <xTabId> --max-duration 10s --json
file /tmp/x.webm
ffprobe -hide_banner /tmp/x.webm

# Tier 1
npm install
./check.sh
npm run schema:check  # once schema support lands
shuvgeist doctor
shuvgeist tab new --label foo https://example.com
shuvgeist screenshot --tab foo --out /tmp/foo.png && test -f /tmp/foo.png

# Tier 2.1
shuvgeist chat "open https://news.ycombinator.com and tell me the top 3 titles"

# Tier 2.2–2.4
shuvgeist launch --enable react-devtools https://react.dev
shuvgeist react tree
shuvgeist vitals
```

`./check.sh` + `npm run build` gate every release per `AGENTS.md`.

---

## Completed work — TTS overlay (kept for reference)

The TTS read-along feature that previously occupied this file has shipped. The full implementation history and Definition-of-Done checklist are preserved below for archaeological reference; do not re-implement.

### Locked decisions (TTS)

| Decision | Value |
|---|---|
| Primary entry point | Sidepanel header speaker button (`Volume2` from `lucide`) |
| Click-to-speak default | Off; user enables in overlay |
| Kokoro integration | OpenAI-compatible `/v1/audio/speech` endpoint |
| Offscreen reasons | `["WORKERS", "AUDIO_PLAYBACK", "BLOBS"]` |
| TTS overlay `worldId` | `shuvgeist-tts-overlay` |
| Click interception | Capture-phase listener with `preventDefault` + `stopImmediatePropagation` |
| Shared text clamp | 3000 chars, in `src/tts/service.ts` before provider dispatch |
| OpenAI key reuse | `providerKeys["openai"]`; first-launch raw-key input in `TtsTab` |
| OpenAI defaults | `gpt-4o-mini-tts` (fallback `tts-1`), `mp3`, speed clamp `[0.25, 4.0]` |
| ElevenLabs defaults | `eleven_turbo_v2_5`, `mp3_44100_128` |
| Kokoro defaults | `kokoro`, `mp3`, `af_heart`, `http://127.0.0.1:8880/v1` |

### Ownership contract (still enforced — important for Tier 2.1 chat-runner work)

- TTS playback state lives on a dedicated page-global: `window.__shuvgeistTtsController`.
- REPL's `finally { sandbox.remove() }` MUST NOT touch `window.__shuvgeistTtsController` or its `<audio>` element.
- **Tier 2.1 chat-runner must not touch it either.** When chat-runner manages offscreen lifecycle, it operates only on its own runner-scoped state and the `chrome.runtime.connect` pin; TTS playback during a chat session must survive.
- TTS teardown is explicit: only `tts-offscreen-stop`, full extension reload, or offscreen document destruction releases the controller. Object URLs are revoked in all three paths.

### Status

All Definition-of-Done items shipped. See `CHANGELOG.md` for the `### Added` entry. The detailed milestone history that previously occupied this file is preserved in git history at tag `before-unified-plan`.
