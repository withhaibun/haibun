#!/bin/bash
# Start x11vnc with optional password support
# Use /home/node explicitly to avoid tilde expansion issues in supervisord

echo "START-VNC: Script started. USER=$(whoami) DISPLAY=$DISPLAY"

if [ -n "$VNC_PASSWORD" ]; then
    # Trim whitespace (safe operation)
    VNC_PASSWORD=$(echo "$VNC_PASSWORD" | xargs)
    echo "START-VNC: VNC_PASSWORD is set (trimmed length: ${#VNC_PASSWORD}). Configuring password auth via file."
    
    mkdir -p /home/node/.vnc
    rm -f /home/node/.vnc/passwd
    
    # Store password in file (standard VNC auth)
    x11vnc -storepasswd "$VNC_PASSWORD" /home/node/.vnc/passwd
    if [ $? -ne 0 ]; then
        echo "START-VNC: Failed to store password!"
        exit 1
    fi
    chmod 600 /home/node/.vnc/passwd
    ls -l /home/node/.vnc/passwd
    
    # Use -rfbauth (standard) with verbose logging
    exec /usr/bin/x11vnc -rfbport 5930 -display ${DISPLAY:-:99} -forever -noxdamage -shared -noshm -listen 0.0.0.0 -verbose -rfbauth /home/node/.vnc/passwd
else
    echo "START-VNC: VNC_PASSWORD is NOT set. Starting without password..."
    echo "START-VNC: WARNING - No password set. Anyone can connect."
    exec /usr/bin/x11vnc -rfbport 5930 -display ${DISPLAY:-:99} -forever -noxdamage -shared -noshm -listen 0.0.0.0 -verbose -nopw
fi
