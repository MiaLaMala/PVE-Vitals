# Proxmox Dashboard

A mobile-first web dashboard for monitoring your Proxmox server — designed to look great on your phone.

## Features

- **Node Overview** — CPU, RAM, disk gauges + sparkline history charts per node
- **VMs & Containers** — live list with status, resource bars, search & filter
- **VM Power Control** — start, shutdown, reboot VMs/CTs directly from the dashboard
- **Storage** — usage bars for every active storage pool
- **Task Log** — recent Proxmox task history with status
- **Auto-refresh** — configurable interval (5s / 10s / 30s / 1min)
- **Fully offline-capable** — no CDN dependencies, runs entirely locally

---

## Quick Setup

### 1. Create a Proxmox API Token

In the Proxmox web UI:

1. Go to **Datacenter → Permissions → API Tokens**
2. Click **Add**
3. User: `root@pam` (or any user with sufficient permissions)
4. Token ID: e.g. `dashboard`
5. **Uncheck** "Privilege Separation" unless you've set up custom roles
6. Copy the secret UUID — you only see it once

### 2. Configure the app

```bash
cp .env.example .env
```

Edit `.env` and fill in your values:

```
PVE_HOST=192.168.1.10       # your Proxmox IP
PVE_TOKEN_ID=root@pam!dashboard
PVE_SECRET=xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
PORT=3000
```

### 3. Install & run

```bash
npm install
npm start
```

The dashboard will be available at `http://<your-pc-ip>:3000`.

On your phone, open that URL in your browser. You can also "Add to Home Screen" for a full-screen app experience.

### 4. (Optional) Run on boot with PM2

```bash
npm install -g pm2
pm2 start server.js --name proxmox-dashboard
pm2 save
pm2 startup
```

---

## Access from your phone

Make sure your phone and the machine running this app are on the same network (or you've set up a VPN/reverse proxy).

The machine's local IP is typically something like `192.168.1.x`. Navigate to `http://192.168.1.x:3000` on your phone.

---

## Project structure

```
.
├── server.js          # Express backend — proxies Proxmox API
├── public/
│   ├── index.html     # App shell
│   ├── style.css      # Mobile-first dark theme
│   └── app.js         # All frontend logic
├── .env.example       # Config template
└── package.json
```

---

## Minimum required Proxmox API permissions

If not using root, grant these roles to your API token user:

| Path        | Role     |
|-------------|----------|
| `/`         | PVEAuditor |
| `/nodes`    | PVEAuditor |

For VM power control, also add `PVEVMAdmin` on `/vms`.
