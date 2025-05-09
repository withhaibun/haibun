#!/bin/bash

LOGFILE=./output/container-setup.log

rm output/walkthrough.webm 2> /dev/null

echo "entrypoint is setting up the environment (logfile is $LOGFILE)"
{
    mkdir -p /run/dbus
    dbus-daemon --system --fork

    export XDG_RUNTIME_DIR=/tmp

    # Start Xvfb in the background
    echo "Setup Xvfb..."
    export RES=1280x800
    Xvfb $DISPLAY -screen 0 ${RES}x24 -ac +extension GLX +render -noreset &

    # Start x11vnc
    echo "Setup x11vnc..."
    x11vnc -display $DISPLAY -forever -noxdamage -shared -nopw -quiet &

    # Start pipewire server
    echo "Starting pipewire..."
    pipewire &
    wireplumber &
    pipewire-pulse &

    echo "Waiting for audio services to be ready..."
    max_attempts=10
    attempt=1
    while ! pactl info >/dev/null 2>&1; do
        echo "Waiting for audio services... attempt $attempt of $max_attempts"
        if [ $attempt -ge $max_attempts ]; then
            echo "Audio services failed to start after $max_attempts attempts"
            cat "$LOGFILE"
            exit 1
        fi
        sleep 1
        attempt=$((attempt + 1))
    done
    pactl info

    # Load the virtual sink and set it as default
    echo "Setting up virtual sink..."
    pactl load-module module-virtual-sink sink_name=v1
    pactl set-default-sink v1
    pactl set-default-source v1.monitor
    sleep 1

# Start recording
ffmpeg \
  -f x11grab \
  -r 30 \
  -thread_queue_size 512 \
  -s "$RES" \
  -i "$DISPLAY" \
  -f pulse \
  -thread_queue_size 512 \
  -i default \
  -c:v libvpx-vp9 \
  -deadline realtime \
  -speed 6 \
  -c:a libopus \
  -flush_packets 1 \
  "output/walkthrough.webm" &

FFMPEG_PID=$!
} > "$LOGFILE" 2>&1

# Check if ffmpeg started successfully
sleep 1
if ! ps -p "$FFMPEG_PID" > /dev/null; then
    echo "FFmpeg failed to start"
    cat "$LOGFILE"
    exit 1
fi

echo "About to run $COMMAND_TO_RECORD"
eval "$COMMAND_TO_RECORD"
echo "finalizing file://${HOST_PROJECT_DIR}/walkthrough.webm"
sleep 5

kill -SIGHUP "$FFMPEG_PID"

