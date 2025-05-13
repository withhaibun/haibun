#!/usr/bin/bash

RES=$(xdpyinfo | awk '/dimensions:/ {print $2}')

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
  "output/vcapture.webm" &

echo $! > /tmp/ffmpeg.pid

FFMPEG_PID=$(cat /tmp/ffmpeg.pid)
sleep 1
if ! ps -p "$FFMPEG_PID" > /dev/null; then
    echo "FFmpeg failed to start"
    exit 1
fi
