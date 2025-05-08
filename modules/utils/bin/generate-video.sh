#!/bin/bash

set -e

# Function to handle errors
handle_error() {
  echo "ERROR: Video generation failed!"
  echo "Reason: $1"
  exit 1
}

# Set up directories needed for Docker volume mounting
echo "Setting up environment..."
mkdir -p assets 2>/dev/null || true

# Find the installed package location
PACKAGE_DIR=$(npm root)/@haibun/utils

# Generate editly configuration from monitor.json
echo "Generating editly configuration..."
# Use the correct path to the built JS file
node "$PACKAGE_DIR/build/generate-video.js" $* || handle_error "Failed to generate editly configuration"

# Run editly using Docker directly instead of alias
echo "Generating video with editly..."

# Run Docker command with proper error handling
if ! docker run --rm -u $(id -u):$(id -g) -v $PWD:/data vimagick/editly editly-config.json; then
  handle_error "Docker editly command failed. Check docker installation and permissions."
fi

# Verify output file exists
OUTPUT_FILE=${2:-haibun-test-video.mp4}
if [ -f "$OUTPUT_FILE" ]; then
  echo "Video generation complete!"
  echo "Output file: $OUTPUT_FILE"
else
  handle_error "Output video file was not created"
fi
