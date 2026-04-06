#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT_DIR"

bash -n benchmarks/browser-benchmark.sh

for _ in $(seq 1 12); do
  if shuvgeist status 2>/dev/null | grep -q 'Extension connected: yes'; then
    break
  fi
  sleep 5
done

if ! shuvgeist status 2>/dev/null | grep -q 'Extension connected: yes'; then
  echo "Shuvgeist bridge is not connected after waiting" >&2
  exit 1
fi

before_file="$(mktemp)"
after_file="$(mktemp)"
trap 'rm -f "$before_file" "$after_file"' EXIT

find /tmp -maxdepth 1 -type d -name 'browser-benchmark-*' -printf '%T@ %p\n' | sort -n > "$before_file"

bench_log="$(mktemp)"
trap 'rm -f "$before_file" "$after_file" "$bench_log"' EXIT

RUN_AGENT_BROWSER=0 RUN_DEV_BROWSER=0 COLD_ITERATIONS=0 benchmarks/browser-benchmark.sh | tee "$bench_log"

find /tmp -maxdepth 1 -type d -name 'browser-benchmark-*' -printf '%T@ %p\n' | sort -n > "$after_file"

results_dir="$(python3 - "$before_file" "$after_file" <<'PY'
import sys
from pathlib import Path
before = {line.strip().split(' ', 1)[1] for line in Path(sys.argv[1]).read_text().splitlines() if line.strip()}
after = [line.strip().split(' ', 1)[1] for line in Path(sys.argv[2]).read_text().splitlines() if line.strip()]
new_dirs = [p for p in after if p not in before]
if new_dirs:
    print(new_dirs[-1])
elif after:
    print(after[-1])
PY
)"

if [[ -z "${results_dir:-}" || ! -d "$results_dir" ]]; then
  echo "Failed to locate benchmark results directory" >&2
  exit 1
fi

python3 - "$results_dir" <<'PY'
import json
import sys
from pathlib import Path

root = Path(sys.argv[1])
WARMUP = 2
means = {}

for raw in sorted(root.glob('sg:*.raw')):
    values = [int(line.strip()) for line in raw.read_text().splitlines() if line.strip()]
    if len(values) > WARMUP:
        values = values[WARMUP:]
    if not values:
        continue
    metric_name = raw.stem.split(':', 1)[1]
    means[metric_name] = sum(values) / len(values)

if not means:
    benchmark_json = root / 'benchmark.json'
    if benchmark_json.exists():
        data = json.loads(benchmark_json.read_text())
        if not data.get('metadata', {}).get('tools', {}).get('shuvgeist', {}).get('available'):
            raise SystemExit('Benchmark ran without Shuvgeist connected: ' + str(root))
    raise SystemExit('No Shuvgeist raw metrics found in ' + str(root))

total_ms = sum(means.values())
print(f'METRIC total_ms={total_ms:.1f}')
for key in ['navigate', 'navigate_complex', 'tabs_list', 'snapshot', 'eval_simple', 'eval_extract', 'screenshot']:
    if key in means:
        print(f'METRIC {key}_ms={means[key]:.1f}')
print(f'METRIC sg_test_count={len(means)}')
print(f'Results dir: {root}')
PY
