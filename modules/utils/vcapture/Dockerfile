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
	# SSH server for VS Code Remote
	openssh-server \
	# Supervisor for robust process management
	supervisor \
	&& rm -rf /var/lib/apt/lists/*

RUN git clone https://github.com/novnc/noVNC.git /opt/noVNC && \
	git clone https://github.com/novnc/websockify /opt/noVNC/utils/websockify

RUN sed -i 's/geteuid/getppid/' /usr/bin/vlc

# Setup SSH
RUN mkdir /var/run/sshd && \
	# Disable password auth, require keys
	sed -i 's/#PasswordAuthentication yes/PasswordAuthentication no/' /etc/ssh/sshd_config && \
	sed -i 's/#PubkeyAuthentication yes/PubkeyAuthentication yes/' /etc/ssh/sshd_config && \
	echo "PermitRootLogin no" >> /etc/ssh/sshd_config && \
	echo "StrictModes no" >> /etc/ssh/sshd_config

# Setup node user for SSH (matches host UID 1000 usually)
RUN mkdir -p /home/node/.ssh && chmod 700 /home/node/.ssh && \
	chown -R node:node /home/node/.ssh && \
	# Allow node to run sudo without password
	echo "node ALL=(ALL) NOPASSWD:ALL" >> /etc/sudoers

WORKDIR /app

COPY package*.json *.sh ./
COPY supervisord.conf /etc/supervisor/conf.d/supervisord.conf
RUN chmod +x *.sh

# Set default password for node user (just in case UI prompts appear)
RUN echo "node:node" | chpasswd

RUN npm i # && npm install kokoro-js # kokoro-js is installed on demand
RUN npx playwright install --with-deps

RUN mkdir -p /run/user/1000 && chown node:node /run/user/1000 && chmod 700 /run/user/1000
RUN mkdir -p /app/output && chown node:node /app/output

# Expose ports
EXPOSE 22 5930 8080 9222

# Environment defaults
ENV DISPLAY=:99
ENV RES=1920x1080

ENTRYPOINT ["/usr/bin/supervisord", "-c", "/etc/supervisor/conf.d/supervisord.conf"]
