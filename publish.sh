#!/bin/bash

# Exit on error
set -e

echo "🔨 Building shuvgeist..."
npm run build

echo "📦 Creating zip archive..."
ZIP_NAME="shuvgeist-latest.zip"

# Remove old zip if it exists
rm -f "${ZIP_NAME}"

# Create a temporary directory with the desired folder name
TEMP_DIR=$(mktemp -d)
cp -r dist-chrome "${TEMP_DIR}/shuvgeist"

# Remove .map files
find "${TEMP_DIR}/shuvgeist" -name "*.map" -type f -delete

# Create zip with shuvgeist as the root folder
cd "${TEMP_DIR}"
zip -r "${ZIP_NAME}" shuvgeist
mv "${ZIP_NAME}" "${OLDPWD}/"
cd "${OLDPWD}"

# Clean up temp directory
rm -rf "${TEMP_DIR}"

echo "📝 Creating version.json..."
# Extract version from dist-chrome manifest.json
VERSION=$(node -p "require('./dist-chrome/manifest.json').version")
echo "{\"version\":\"${VERSION}\"}" > version.json

echo "📤 Uploading to server..."
SERVER="${SERVER:-slayer.marioslab.io}"
REMOTE_PATH="${REMOTE_PATH:-}"

if [ -z "${REMOTE_PATH}" ]; then
    echo "Set REMOTE_PATH before publishing."
    exit 1
fi

# Ensure uploads directory exists on server
ssh "${SERVER}" "mkdir -p ${REMOTE_PATH}"

# Upload files
scp "${ZIP_NAME}" "${SERVER}:${REMOTE_PATH}/"
scp "version.json" "${SERVER}:${REMOTE_PATH}/"

echo "✅ Done! Version ${VERSION} published."
