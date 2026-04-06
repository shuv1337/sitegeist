#!/usr/bin/env bash
set -euo pipefail

log_file="$(mktemp)"
trap 'rm -f "$log_file"' EXIT

if ! ./check.sh >"$log_file" 2>&1; then
  tail -80 "$log_file"
  exit 1
fi
