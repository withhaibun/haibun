FROM mcr.microsoft.com/playwright:v1.52.0-noble

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
    && rm -rf /var/lib/apt/lists/*

RUN sed -i 's/geteuid/getppid/' /usr/bin/vlc

WORKDIR /app

# Copy all needed files at once
COPY package*.json kokoro-speak.cjs speak-to-wav.sh ./

# Single npm install for everything
RUN npm i && \
    npm install kokoro-js

RUN mkdir -p /run/user/1000 && chmod 700 /run/user/1000

COPY entrypoint.sh ./
RUN chmod +x speak-to-wav.sh entrypoint.sh

ENTRYPOINT ["./entrypoint.sh"]
