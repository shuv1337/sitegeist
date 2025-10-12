#!/bin/bash

# Exit on error
set -e

echo "🔨 Building pi-mono..."
cd ../pi-mono
npm run build

echo "🔨 Building sitegeist..."
cd ../sitegeist
npm run build

echo "📦 Creating zip archive..."
ZIP_NAME="sitegeist-latest.zip"

# Remove old zip if it exists
rm -f "${ZIP_NAME}"

# Create a temporary directory with the desired folder name
TEMP_DIR=$(mktemp -d)
cp -r dist-chrome "${TEMP_DIR}/sitegeist"

# Create zip with sitegeist as the root folder
cd "${TEMP_DIR}"
zip -r "${ZIP_NAME}" sitegeist
mv "${ZIP_NAME}" "${OLDPWD}/"
cd "${OLDPWD}"

# Clean up temp directory
rm -rf "${TEMP_DIR}"

echo "📤 Uploading to server..."
# Upload using the upload CLI tool
upload "${ZIP_NAME}"
upload "docs/sitegeist.html"

echo "✅ Done!"
