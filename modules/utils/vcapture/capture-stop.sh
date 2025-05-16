#!/usr/bin/bash

FFMPEG_PID=$(cat /tmp/ffmpeg.pid)
if [ -z "$FFMPEG_PID" ]; then
		echo "FFmpeg PID not found in /tmp/ffmpeg.pid"
		exit 1
fi
if ! kill -SIGHUP "$FFMPEG_PID"; then
    echo "Warning: Failed to send SIGHUP to FFmpeg process $FFMPEG_PID"
fi
