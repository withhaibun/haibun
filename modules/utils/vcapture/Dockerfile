FROM node:24-bookworm

# Set non-interactive mode to avoid prompts
ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update && apt-get install -y \
	alsa-utils \
	psmisc \
	procps \
	wget \
	xdg-utils \
	xvfb \
	ffmpeg \
	curl \
	vim-tiny \
	strace \
	bash \
	software-properties-common \
	dbus-x11 \
	dbus-user-session \
	x11vnc \
	x11-utils \
	vlc \
	pipewire \
	pipewire-pulse \
	wireplumber \
	pipewire-audio-client-libraries \
	pulseaudio-utils \
	libportaudio2 \
	xfce4 \
	xfce4-terminal \
	xterm \
	&& rm -rf /var/lib/apt/lists/*

RUN git clone https://github.com/novnc/noVNC.git /opt/noVNC && \
	git clone https://github.com/novnc/websockify /opt/noVNC/utils/websockify

RUN sed -i 's/geteuid/getppid/' /usr/bin/vlc

WORKDIR /app

COPY package*.json *.sh ./
RUN chmod +x *.sh

RUN npm i # && npm install kokoro-js # kokoro-js is installed on demand in capture-start.sh
RUN npx playwright install --with-deps

RUN mkdir -p /run/user/1000 && chmod 700 /run/user/1000

# Set xfce4 as the default desktop environment
ENTRYPOINT ["./entrypoint.sh"]
