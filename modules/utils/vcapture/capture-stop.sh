#!/usr/bin/bash

FFMPEG_PID=$(cat /tmp/ffmpeg.pid)
if [ -z "$FFMPEG_PID" ]; then
		echo "FFmpeg PID not found in /tmp/ffmpeg.pid"
		exit 1
fi
kill -SIGHUP "$FFMPEG_PID"
