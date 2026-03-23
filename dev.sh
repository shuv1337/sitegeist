#!/bin/bash

# Start all development servers for shuvgeist and its dependencies
# Usage: ./dev.sh

set -e

echo "Starting development servers..."
echo ""

# Check if required directories exist
if [ ! -d "../pi-mono" ]; then
    echo "Error: pi-mono not found at ../pi-mono"
    exit 1
fi

if [ ! -d "../mini-lit" ]; then
    echo "Error: mini-lit not found at ../mini-lit"
    exit 1
fi

# Kill all child processes on exit
trap 'echo ""; echo "Stopping all dev servers..."; kill 0' EXIT INT TERM

# Start dev servers
echo "Starting mini-lit dev server..."
(cd ../mini-lit && npm run dev:tsc) &
MINI_LIT_PID=$!

echo "Starting pi-mono dev server..."
(cd ../pi-mono && npm run dev:tsc) &
PI_MONO_PID=$!

# Wait a moment for dependencies to start building
sleep 2

echo "Starting shuvgeist dev server..."
npm run dev &
SITEGEIST_PID=$!

echo "Starting shuvgeist site dev server..."
(cd site && ./run.sh dev) &
SITE_PID=$!

echo ""
echo "All dev services started"
echo "  mini-lit: watching"
echo "  pi-mono: watching"
echo "  shuvgeist: watching"
echo "  site backend: http://localhost:3000"
echo "  site frontend: http://localhost:8080"
echo ""
echo "Press Ctrl+C to stop all services"
echo ""

# Wait for all background jobs
wait
