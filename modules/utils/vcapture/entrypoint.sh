#!/bin/bash +x

LOGFILE=./output/container-setup.log

rm output/vcapture.webm 2>/dev/null

echo "entrypoint is setting up the environment (logfile is $LOGFILE)"
{
	mkdir -p /run/dbus
	dbus-daemon --system --fork

	export XDG_RUNTIME_DIR=/tmp

	# Start Xvfb in the background
	echo "Setup Xvfb..."
	Xvfb $DISPLAY -screen 0 ${RES}x24 -ac +extension GLX +render -noreset &

	# Start x11vnc
	echo "Setup x11vnc..."
	x11vnc -rfbport 5930 -display $DISPLAY -forever -noxdamage -shared -nopw -quiet &

	# In entrypoint.sh, after starting x11vnc
	echo "Starting noVNC websockify proxy on port 8080 (to 5930)..."
	/opt/noVNC/utils/novnc_proxy --vnc localhost:5930 --listen 8080 &

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

} >"$LOGFILE" 2>&1

echo "About to run $COMMAND_TO_RECORD"
eval "$COMMAND_TO_RECORD"
SLEEPTIME=2
echo "Waiting for $SLEEPTIME seconds."
sleep $SLEEPTIME
