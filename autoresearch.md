# Autoresearch: browser benchmark candidate optimization analysis

## Objective
Use `benchmarks/browser-benchmark.sh` as the source-of-truth workload, but run the autoresearch loop in **Shuvgeist-only mode**. Agent-browser and dev-browser comparisons were useful for initial triage, but they should no longer be part of the iterative benchmark plan.

The optimization target is now purely internal: reduce Shuvgeist's own end-to-end CLI benchmark time without losing functionality. The current high-cost Shuvgeist paths of interest are:

1. **Navigation latency**
   - `navigate`
   - `navigate_complex`
2. **Tab/listing and bridge overhead**
   - `tabs_list`
3. **Screenshot variability / regressions**
   - `screenshot`

Early code inspection suggests these are the highest-value candidates:
- CLI per-command bootstrap overhead in `src/bridge/cli.ts`
- Per-request WebSocket registration/teardown in the CLI/bridge path
- Navigation post-processing in `src/tools/navigate.ts`, especially skill lookup/formatting after successful navigation
- Minor bridge dispatch overhead in server/client/executor layers

## Metrics
- **Primary**: `total_ms` (ms, lower is better)
- **Secondary**:
  - `navigate_ms`
  - `navigate_complex_ms`
  - `tabs_list_ms`
  - `snapshot_ms`
  - `eval_simple_ms`
  - `eval_extract_ms`
  - `screenshot_ms`
  - `sg_test_count`

## How to Run
`./autoresearch.sh` — runs `benchmarks/browser-benchmark.sh` with `RUN_AGENT_BROWSER=0` and `RUN_DEV_BROWSER=0`, parses the newest result directory, and prints `METRIC ...` lines.

## Files in Scope
- `benchmarks/browser-benchmark.sh` — benchmark workload definition and result layout
- `src/bridge/cli.ts` — CLI entrypoint, command dispatch, bridge auto-start behavior
- `src/bridge/cli-core.ts` — command planning and flag parsing
- `src/bridge/server.ts` — bridge relay and request forwarding
- `src/bridge/extension-client.ts` — extension WebSocket client
- `src/bridge/browser-command-executor.ts` — bridge method dispatch to extension tools
- `src/bridge/protocol.ts` — bridge method/capability definitions
- `src/tools/navigate.ts` — navigate/list/switch implementation and post-navigation skill loading
- `src/tools/helpers/browser-target.ts` — active-tab resolution used across bridge commands
- `autoresearch.sh` / `autoresearch.checks.sh` / `autoresearch.ideas.md` — experiment harness files

## Off Limits
- `../mini-lit/**` and `../pi-mono/**` sibling dependencies unless a change is proven necessary
- `site/**` marketing website
- release/version files unless explicitly needed for the experiment
- removing benchmark coverage or functionality to make numbers look better

## Constraints
- No loss of functionality
- Keep CLI and bridge behavior semantically equivalent unless a benchmark-backed improvement preserves behavior
- If extension runtime/UI code changes, rebuild `dist-chrome/` with `npm run build`
- If CLI bridge code changes, rebuild with `npm run build:cli`
- Run correctness checks via `autoresearch.checks.sh` before any result can be kept

## What's Been Tried
- Reviewed `benchmarks/browser-benchmark.sh`: the script measures warm-path command latency by timing entire CLI invocations and writes per-test raw timings into `/tmp/browser-benchmark-<timestamp>/`.
- Initial triage used cross-tool comparisons from `/tmp/browser-benchmark-20260405-161603/` to identify likely Shuvgeist bottlenecks.
- The active plan has now narrowed to **Shuvgeist-only** benchmarking. Agent-browser and dev-browser should stay disabled during autoresearch iterations to reduce noise and wasted runtime.
- Reviewed likely hotspot files:
  - `src/bridge/cli.ts`
  - `src/bridge/cli-core.ts`
  - `src/bridge/server.ts`
  - `src/bridge/extension-client.ts`
  - `src/bridge/browser-command-executor.ts`
  - `src/tools/navigate.ts`
- Baseline harness was hardened to wait for active Shuvgeist bridge connectivity before running.
- Discarded experiments so far:
  - lazy-starting `ensureBridgeServer()` only on missing config/network failure in `src/bridge/cli.ts` — worsened total benchmark time
  - optimistic request send before `register_result` in `src/bridge/cli.ts` — worsened total benchmark time
  - switching background screenshot capture to CDP WebP output — worsened screenshot time
- Current hypotheses:
  - one-shot CLI WebSocket connect/register/close overhead is a likely floor on every command
  - navigate-specific skill lookup and formatting likely adds extra latency beyond the shared CLI/bridge overhead
  - `tabs_list` remains a good micro-optimization target because it isolates bridge/CLI overhead better than navigation
