#!/usr/bin/env bash

# Copyright (c) 2021-2026 community-scripts ORG
# Author: Mia Grünwald (MiaLaMala)
# License: MIT | https://github.com/community-scripts/ProxmoxVED/raw/main/LICENSE
# Source: https://github.com/MiaLaMala/PVE-Vitals

source /dev/stdin <<<"$FUNCTIONS_FILE_PATH"
color
verb_ip6
catch_errors
setting_up_container
network_check
update_os

msg_info "Installing Dependencies"
$STD apt-get install -y \
  curl \
  sudo \
  mc \
  git \
  ca-certificates
msg_ok "Installed Dependencies"

NODE_VERSION="20" setup_nodejs

msg_info "Installing ${APPLICATION}"
cd /opt
$STD git clone --depth=1 https://github.com/MiaLaMala/PVE-Vitals.git pve-vitals
cd /opt/pve-vitals
$STD npm install --omit=dev --no-audit --no-fund
INSTALLED_VERSION=$(git rev-parse --short HEAD)
cache_installed_version "pve-vitals" "$INSTALLED_VERSION"
msg_ok "Installed ${APPLICATION} (${INSTALLED_VERSION})"

msg_info "Configuring ${APPLICATION}"
cat <<EOF >/opt/pve-vitals/.env
# ==== Proxmox connection ====================================================
# Fill these in, then: systemctl restart pve-vitals
#
# Create an API token: Datacenter > Permissions > API Tokens > Add
# The token user only needs role PVEAuditor on / (read-only).
PVE_HOST=
PVE_PORT=8006
PVE_TOKEN_ID=root@pam!vitals
PVE_SECRET=

# ==== App settings ==========================================================
PORT=3000
CACHE_TTL=10
DEFAULT_LANG=en
DEFAULT_THEME=auto

# Optional bearer token protecting /api/* and /metrics. Leave empty to disable.
DASHBOARD_TOKEN=
EOF
chmod 600 /opt/pve-vitals/.env
msg_ok "Configured ${APPLICATION}"

msg_info "Creating Service"
cat <<EOF >/etc/systemd/system/pve-vitals.service
[Unit]
Description=PVE-Vitals read-only Proxmox status wall
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory=/opt/pve-vitals
EnvironmentFile=/opt/pve-vitals/.env
ExecStart=/usr/bin/node /opt/pve-vitals/server.js
Restart=always
RestartSec=5
StartLimitIntervalSec=0

[Install]
WantedBy=multi-user.target
EOF
systemctl enable -q --now pve-vitals
msg_ok "Created Service"

motd_ssh
customize
cleanup_lxc
