#!/usr/bin/env bash
source <(curl -fsSL https://raw.githubusercontent.com/community-scripts/ProxmoxVED/main/misc/build.func)
# Copyright (c) 2021-2026 community-scripts ORG
# Author: Mia Grünwald (MiaLaMala)
# License: MIT | https://github.com/community-scripts/ProxmoxVED/raw/main/LICENSE
# Source: https://github.com/MiaLaMala/PVE-Vitals

APP="PVE-Vitals"
var_tags="${var_tags:-dashboard;monitoring}"
var_cpu="${var_cpu:-1}"
var_ram="${var_ram:-512}"
var_disk="${var_disk:-2}"
var_os="${var_os:-debian}"
var_version="${var_version:-13}"
var_unprivileged="${var_unprivileged:-1}"

header_info "$APP"
variables
color
catch_errors

function update_script() {
  header_info
  check_container_storage
  check_container_resources

  if [[ ! -d /opt/pve-vitals ]]; then
    msg_error "No ${APP} Installation Found!"
    exit
  fi

  cd /opt/pve-vitals
  $STD git fetch --quiet origin
  DEFAULT_BRANCH=$(git symbolic-ref --short refs/remotes/origin/HEAD 2>/dev/null | sed 's@^origin/@@')
  [[ -z "$DEFAULT_BRANCH" ]] && DEFAULT_BRANCH=main
  REMOTE_VERSION=$(git rev-parse --short "origin/${DEFAULT_BRANCH}")
  CURRENT_VERSION=$(get_cached_version "pve-vitals")
  [[ -z "$CURRENT_VERSION" ]] && CURRENT_VERSION=$(git rev-parse --short HEAD)

  if [[ "$REMOTE_VERSION" == "$CURRENT_VERSION" ]]; then
    msg_ok "No update required. ${APP} is already at ${CURRENT_VERSION}."
    exit
  fi

  NODE_VERSION="20" setup_nodejs

  msg_info "Stopping Service"
  systemctl stop pve-vitals
  msg_ok "Stopped Service"

  msg_info "Updating ${APP} to ${REMOTE_VERSION}"
  $STD git reset --hard "origin/${DEFAULT_BRANCH}"
  $STD npm install --omit=dev --no-audit --no-fund
  cache_installed_version "pve-vitals" "$REMOTE_VERSION"
  msg_ok "Updated ${APP} to ${REMOTE_VERSION}"

  msg_info "Starting Service"
  systemctl start pve-vitals
  msg_ok "Started Service"
  msg_ok "Updated Successfully!"
  exit
}

start
build_container
description

msg_ok "Completed Successfully!\n"
echo -e "${CREATING}${GN}${APP} setup has been successfully initialized!${CL}"
echo -e "${INFO}${YW} Access it using the following URL:${CL}"
echo -e "${TAB}${GATEWAY}${BGN}http://${IP}:3000${CL}"
echo -e "${INFO}${YW} Configure your Proxmox API token in:${CL}"
echo -e "${TAB}${GATEWAY}${BGN}/opt/pve-vitals/.env${CL}"
echo -e "${INFO}${YW} Then restart the service:${CL}"
echo -e "${TAB}${GATEWAY}${BGN}systemctl restart pve-vitals${CL}"
