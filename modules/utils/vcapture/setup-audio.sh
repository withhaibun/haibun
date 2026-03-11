#!/bin/bash
# Setup virtual audio sink after pipewire-pulse is ready

echo "Waiting for PulseAudio to be ready..."
max_attempts=30
attempt=1

while ! pactl info >/dev/null 2>&1; do
    echo "Waiting for audio services... attempt $attempt of $max_attempts"
    if [ $attempt -ge $max_attempts ]; then
        echo "Audio services failed to start after $max_attempts attempts"
        exit 1
    fi
    sleep 1
    attempt=$((attempt + 1))
done

echo "PulseAudio ready. Setting up virtual sink..."
pactl load-module module-virtual-sink sink_name=v1
pactl set-default-sink v1
pactl set-default-source v1.monitor
pactl info

echo "Audio setup complete."
