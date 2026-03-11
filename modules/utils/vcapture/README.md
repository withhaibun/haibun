# Haibun VCapture Container

A Docker container providing a graphical Linux environment for:
- **Recording sessions** with video/audio capture
- **Narrator testing** with TTS output
- **VS Code Remote Development** via SSH

## Quick Start

```bash
# Build and start
docker compose up -d --build

# Check health
docker compose ps
```

## Access Methods

### 1. VNC via Browser (noVNC)
Open http://localhost:8080 in your browser for a web-based VNC client.

### 2. Native VNC Client
Connect to `localhost:5930` with any VNC client (TigerVNC, RealVNC, etc.)

### 3. VS Code Remote SSH

Add to your `~/.ssh/config`:
```
Host haibun-recorder
    HostName localhost
    Port 2222
    User node
    IdentityFile ~/.ssh/id_rsa
```

Then in VS Code: `Remote-SSH: Connect to Host...` → `haibun-recorder`

## Ports

| Port | Service | Description |
|------|---------|-------------|
| 8080 | noVNC | Web-based VNC access |
| 5930 | VNC | Native VNC client access |
| 2222 | SSH | VS Code Remote / terminal |
| 9222 | Chrome DevTools | Playwright debugging |

## SSH Key Setup

Your `~/.ssh/id_rsa.pub` is mounted automatically. If you use a different key:

```yaml
volumes:
  - ~/.ssh/your_key.pub:/home/dev/.ssh/authorized_keys:ro
```

## Recording Sessions

From inside the container (via SSH or VNC terminal):

```bash
./capture-start.sh  # Start ffmpeg recording
# ... do your work ...
./capture-stop.sh   # Stop and save to output/
```

Recordings are saved to `./output/` which is persisted on your host.

## Process Management

All services are managed by **supervisor** for robustness:
- Services auto-restart on failure
- Logs available in `./output/*.log`
- Check status: `docker compose exec haibun-recorder supervisorctl status`

## Customization

### Resolution
Change in docker-compose.yml:
```yaml
environment:
  - RES=2560x1440
```

### SSH Key Location
If your public key is not at `~/.ssh/id_rsa.pub`, specify it:

```bash
SSH_PUBKEY_PATH=~/.ssh/id_ed25519.pub docker compose up -d
```

### Mount Your Project
By default, the parent directory (`../../..`) is mounted to `/workspace`. Override this:

```bash
WORKSPACE_MOUNT=~/my-project docker compose up -d
```

## Troubleshooting SSH

If prompted for a password:
1. Ensure you mounted the **public key** (`.pub`), not private key.
2. If host key changed: `ssh-keygen -R "[localhost]:2222"`
3. Bypass host key checks:
   ```bash
   ```
   ssh -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -p 2222 node@localhost
   ```

### VNC Password
To secure VNC access (defaults to no password):

```bash
VNC_PASSWORD=mysecret docker compose up -d
```
