# PVE Vitals

An always-on, read-only status wall for your Proxmox VE cluster.
Green means fine. Red means go look.

Designed to live on a dedicated monitor so you can glance across the room and instantly know whether your cluster is healthy. No buttons, no controls, no clicks needed: this is pure information.

Looking for the German readme? See [README.de.md](README.de.md).

## Run with Docker

```bash
cp .env.example .env     # fill in PVE_HOST / tokens
docker compose up -d --build
```

The compose file mounts a named volume for `.state/` so the shared alert-ack timestamp survives restarts.

## One-line install (Debian or Ubuntu)

Run this on the machine that will host the display (a Debian 12 LXC on your Proxmox host is the recommended target):

```bash
bash -c "$(curl -fsSL https://raw.githubusercontent.com/MiaLaMala/PVE-Vitals/main/install.sh)"
```

The installer sets up Node.js 20, clones the repo, prompts for your Proxmox API token, and starts the app under PM2 with auto-start on boot. Re-running the one-liner updates the app in place.

Prefer to read the script before running it? It lives at `install.sh` in this repo.

## Run in a fresh Proxmox LXC (host-side one-liner)

If you're sitting at a Proxmox host and want a display running in one shot, create a small Debian 13 unprivileged LXC and install inside it. Paste this into the Proxmox node's shell:

```bash
VMID=900                 # any free VMID
STORAGE=local-lvm        # rootfs storage (local-lvm, local-zfs, ...)

# Grab the latest Debian 13 template
pveam update
TEMPLATE=$(pveam available | awk '$2 ~ /^debian-13-standard.*amd64\.tar\.zst$/ {print $2; exit}')
pveam download local "$TEMPLATE"

pct create $VMID "local:vztmpl/$TEMPLATE" \
  --hostname pve-vitals \
  --cores 1 --memory 512 --swap 256 \
  --rootfs $STORAGE:2 \
  --net0 name=eth0,bridge=vmbr0,ip=dhcp \
  --unprivileged 1 --features nesting=1 \
  --onboot 1 --start 1
```

Once the container is up, enter it and run the installer:

```bash
pct enter $VMID
bash -c "$(curl -fsSL https://raw.githubusercontent.com/MiaLaMala/PVE-Vitals/main/install.sh)"
```

Resources are intentionally small (1 CPU, 512 MB RAM, 2 GB disk): the app is a tiny read-only proxy. The installer will prompt for your Proxmox host IP and API token. A token user with role `PVEAuditor` on `/` is all it needs.

## Features

- Live node health (CPU, RAM, disk, uptime) with sparkline history that cycles hour / day / week
- VM and container overview with per-guest load bars
- Storage usage across every active pool
- Recent task feed with failure highlighting
- Alert engine with configurable warn and crit thresholds
- Screen-burn protection via subtle pixel drift
- Bilingual UI: English and German, auto-detected from the browser, override with `?lang=de`
- Self-contained, no CDN dependencies, runs fully on your LAN
- Strictly read-only: no control endpoints exist in the codebase

## Manual install

If you don't want to run the one-liner, follow the steps below.

### 1. Create a read-only API token in Proxmox

In the Proxmox web UI:

1. **Datacenter > Permissions > API Tokens > Add**
2. User: any user with `PVEAuditor` on `/` (root works)
3. Token ID: e.g. `vitals`
4. Uncheck "Privilege Separation" unless you have set up custom roles
5. Copy the secret UUID shown once

Minimum required role for the token user:

| Path | Role |
|------|------|
| `/`  | PVEAuditor |

### 2. Configure the app

```bash
cp .env.example .env
```

Fill in your values:

```
PVE_HOST=192.168.1.10
PVE_TOKEN_ID=root@pam!vitals
PVE_SECRET=xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
PORT=3000
```

Optional: alert thresholds (percent) and default UI language.

```
CPU_WARN=80
CPU_CRIT=95
MEM_WARN=85
MEM_CRIT=95
DISK_WARN=85
DISK_CRIT=95
STORAGE_WARN=85
STORAGE_CRIT=95
DEFAULT_LANG=en

# Force a UI language regardless of browser. Empty = auto-detect.
FORCE_LANG=

# Show the Proxmox and dashboard addresses in the on-screen footer.
# Default off. Only enable if the monitor is physically private.
SHOW_HOST_INFO=false
```

### 3. Install and run

```bash
npm install
npm start
```

The display is available at `http://<host>:3000`.

### 4. Run on boot with PM2 (recommended)

```bash
npm install -g pm2
pm2 start server.js --name pve-vitals
pm2 save
pm2 startup
```

### 5. Point a monitor at it

Any kiosk-style browser works. Popular choices:

- **Raspberry Pi** in kiosk mode:
  ```
  chromium-browser --kiosk --noerrdialogs --disable-session-crashed-bubble http://pve-vitals.lan:3000
  ```
- **macOS**: Safari > View > Enter Full Screen
- **Windows / Linux desktop**: press F11 in your browser

## Alert rules

The health banner at the top aggregates to one of three states:

- **OK** (green): nothing is over its warn threshold
- **Warn** (yellow): at least one metric is over its warn threshold, or a recent task failed
- **Crit** (red): a node is offline, a metric is over its crit threshold, or the Proxmox API is unreachable

Individual alerts also render as chips directly under the banner.

## Language

The UI picks English or German from the browser. Override order:

1. URL `?lang=de` or `?lang=en` (always wins; useful for quick testing)
2. `FORCE_LANG=de|en` in `.env` (locks the language regardless of the browser)
3. Browser `Accept-Language`
4. `DEFAULT_LANG=de|en` in `.env` (final fallback)

## Auto-deploy via GitLab webhook

`deploy.js` is a tiny HTTP listener. When GitLab posts a push event to it, it pulls the repo and restarts the PM2 process.

### On your server

```bash
DEPLOY_SECRET=some-strong-secret \
REPO_PATH=/opt/pve-vitals \
PM2_APP=pve-vitals \
pm2 start deploy.js --name deploy-webhook
pm2 save
```

| Variable | Default | Description |
|---|---|---|
| `DEPLOY_SECRET` | required | Shared secret with GitLab |
| `REPO_PATH` | `/opt/pve-vitals` | Local repo path on the server |
| `PM2_APP` | `pve-vitals` | PM2 process name to restart |
| `DEPLOY_PORT` | `4000` | Port the webhook listener binds to |

### In GitLab

Settings > Webhooks > Add new webhook

| Field | Value |
|---|---|
| URL | `http://your-server-ip:4000/deploy` |
| Secret token | same as `DEPLOY_SECRET` |
| Trigger | Push events on `main` |

## Project structure

```
.
├── server.js              # Express backend, read-only Proxmox proxy
├── install.sh             # One-line installer for Debian and Ubuntu
├── deploy.js              # Optional GitLab webhook auto-deploy
├── public/
│   ├── index.html         # App shell
│   ├── style.css          # Kiosk-first dark theme
│   └── app.js             # Frontend logic, i18n, alerts, sparklines
├── .env.example           # Config template
└── package.json
```

## Why PVE Vitals (and not the Proxmox web UI)?

The Proxmox UI is powerful, but it is:

- Behind a login screen
- Designed for operators making changes
- Dense with information no one in the room cares about at 3am

PVE Vitals is the opposite: one page, no login, tuned for peripheral vision. It answers exactly one question: "is anything wrong right now?"

## Prometheus

A `/metrics` endpoint exposes node and guest metrics in Prometheus text format. Example scrape config:

```yaml
scrape_configs:
  - job_name: pve-vitals
    static_configs:
      - targets: ['pve-vitals.lan:3000']
    # Required only when DASHBOARD_TOKEN is set:
    authorization:
      type: Bearer
      credentials: your-token-here
```

## Optional auth

Set `DASHBOARD_TOKEN=<secret>` in `.env` to gate `/api/*` and `/metrics`. The dashboard URL then needs `?token=<secret>` for the browser, and scrapers send `Authorization: Bearer <secret>`.

## Credits

Built by **Mia Grünwald**.

Source: https://github.com/MiaLaMala/PVE-Vitals

## License

MIT
