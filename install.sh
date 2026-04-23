#!/usr/bin/env bash
# =============================================================================
# PVE Vitals installer
# Installs the app on Debian or Ubuntu (bare metal, VM, or LXC).
#
# One-liner:
#   bash -c "$(curl -fsSL https://raw.githubusercontent.com/MiaLaMala/PVE-Vitals/main/install.sh)"
#
# Non-interactive (preset via env):
#   PVE_HOST=1.2.3.4 PVE_TOKEN_ID=root@pam!vitals PVE_SECRET=uuid \
#     bash -c "$(curl -fsSL https://raw.githubusercontent.com/MiaLaMala/PVE-Vitals/main/install.sh)"
# =============================================================================

set -euo pipefail

REPO_URL="${REPO_URL:-https://github.com/MiaLaMala/PVE-Vitals.git}"
INSTALL_DIR="${INSTALL_DIR:-/opt/pve-vitals}"
APP_PORT="${APP_PORT:-3000}"
NODE_MAJOR="${NODE_MAJOR:-20}"
PM2_NAME="pve-vitals"

C_R=$'\033[0;31m'; C_G=$'\033[0;32m'; C_Y=$'\033[0;33m'; C_B=$'\033[0;34m'
C_D=$'\033[2m';    C_N=$'\033[0m'
say()  { printf '%s==>%s %s\n' "$C_B" "$C_N" "$*"; }
ok()   { printf '%sok%s  %s\n' "$C_G" "$C_N" "$*"; }
warn() { printf '%s!!%s  %s\n' "$C_Y" "$C_N" "$*"; }
die()  { printf '%serror%s %s\n' "$C_R" "$C_N" "$*" >&2; exit 1; }

# ==== Preflight =============================================================
[ "${EUID:-$(id -u)}" -eq 0 ] || die "Run as root (e.g. sudo bash install.sh)"
[ -f /etc/os-release ] || die "Unsupported OS (no /etc/os-release)"
. /etc/os-release
case "${ID:-}" in
  debian|ubuntu) : ;;
  *)
    case "${ID_LIKE:-}" in
      *debian*|*ubuntu*) : ;;
      *) die "Only Debian and Ubuntu are supported (detected: ${PRETTY_NAME:-unknown}). Tip: install inside a Debian 12 LXC on your Proxmox host." ;;
    esac
  ;;
esac
[ -f /etc/pve/local/pve-ssl.pem ] && warn "Running directly on the Proxmox host. This works, but a Debian LXC is cleaner for updates."

# ==== Prompts (read from /dev/tty so curl|bash still works) ==================
# Look up an env var by name without tripping `set -u` when unset.
get_env() { printenv -- "$1" 2>/dev/null || true; }

prompt() {
  local var="$1" msg="$2" default="${3:-}"
  local val
  val="$(get_env "$var")"
  if [ -z "$val" ]; then
    [ -r /dev/tty ] || die "Prompt for $var needs a TTY. Pass $var via environment for non-interactive install."
    if [ -n "$default" ]; then printf "%s [%s]: " "$msg" "$default" > /dev/tty
    else                        printf "%s: " "$msg" > /dev/tty
    fi
    IFS= read -r val < /dev/tty || true
    [ -z "$val" ] && val="$default"
  fi
  printf '%s' "$val"
}

prompt_secret() {
  local var="$1" msg="$2"
  local val
  val="$(get_env "$var")"
  if [ -z "$val" ]; then
    [ -r /dev/tty ] || die "Prompt for $var needs a TTY. Pass $var via environment for non-interactive install."
    printf "%s: " "$msg" > /dev/tty
    IFS= read -rs val < /dev/tty || true
    printf '\n' > /dev/tty
  fi
  printf '%s' "$val"
}

# ==== System packages =======================================================
say "Installing system packages"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq curl ca-certificates gnupg git

# Node.js (NodeSource repo) if missing or too old
need_node=1
if command -v node >/dev/null 2>&1; then
  have=$(node -v | sed 's/^v//' | cut -d. -f1)
  [ "${have:-0}" -ge "$NODE_MAJOR" ] && need_node=0
fi
if [ "$need_node" -eq 1 ]; then
  say "Installing Node.js $NODE_MAJOR via NodeSource"
  install -d -m 0755 /etc/apt/keyrings
  curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key \
    | gpg --dearmor --yes -o /etc/apt/keyrings/nodesource.gpg
  echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_${NODE_MAJOR}.x nodistro main" \
    > /etc/apt/sources.list.d/nodesource.list
  apt-get update -qq
  apt-get install -y -qq nodejs
fi

if ! command -v pm2 >/dev/null 2>&1; then
  say "Installing PM2"
  npm install -g pm2 --silent --no-audit --no-fund
fi

# ==== Fetch the app =========================================================
if [ -d "$INSTALL_DIR/.git" ]; then
  say "Updating existing install in $INSTALL_DIR"
  git -C "$INSTALL_DIR" remote set-url origin "$REPO_URL" 2>/dev/null || true
  git -C "$INSTALL_DIR" fetch --quiet origin
  default_branch=$(git -C "$INSTALL_DIR" symbolic-ref --short refs/remotes/origin/HEAD 2>/dev/null | sed 's@^origin/@@' || true)
  [ -z "$default_branch" ] && default_branch=main
  git -C "$INSTALL_DIR" reset --hard "origin/$default_branch" --quiet
else
  say "Cloning $REPO_URL into $INSTALL_DIR"
  rm -rf "$INSTALL_DIR"
  git clone --depth=1 --quiet "$REPO_URL" "$INSTALL_DIR"
fi

say "Installing npm dependencies"
( cd "$INSTALL_DIR" && npm install --omit=dev --silent --no-audit --no-fund )

# ==== Config ================================================================
ENV_FILE="$INSTALL_DIR/.env"
if [ -f "$ENV_FILE" ]; then
  say ".env already present, keeping it (delete $ENV_FILE to reconfigure)"
else
  say "Configuring .env"
  echo
  echo "Enter your Proxmox connection info."
  echo "Create a read-only API token first: Datacenter > Permissions > API Tokens > Add"
  echo "Grant the token user PVEAuditor on /."
  echo
  PVE_HOST_V=$(prompt PVE_HOST "Proxmox host IP or hostname" "")
  [ -n "$PVE_HOST_V" ] || die "PVE_HOST is required"
  PVE_PORT_V=$(prompt PVE_PORT "Proxmox web UI port" "8006")
  PVE_TOKEN_ID_V=$(prompt PVE_TOKEN_ID "API token ID" "root@pam!vitals")
  PVE_SECRET_V=$(prompt_secret PVE_SECRET "API token secret (UUID, input hidden)")
  [ -n "$PVE_SECRET_V" ] || die "PVE_SECRET is required"
  LANG_V=$(prompt DEFAULT_LANG "Default UI language (en or de)" "en")

  umask 077
  cat > "$ENV_FILE" <<EOF
PVE_HOST=$PVE_HOST_V
PVE_PORT=$PVE_PORT_V
PVE_TOKEN_ID=$PVE_TOKEN_ID_V
PVE_SECRET=$PVE_SECRET_V
PORT=$APP_PORT
CACHE_TTL=10
DEFAULT_LANG=$LANG_V
EOF
  chown root:root "$ENV_FILE"
  chmod 600 "$ENV_FILE"
  ok ".env written to $ENV_FILE (mode 600)"
fi

# ==== PM2 ===================================================================
say "Starting PVE Vitals under PM2"
cd "$INSTALL_DIR"
if pm2 describe "$PM2_NAME" >/dev/null 2>&1; then
  pm2 restart "$PM2_NAME" --update-env >/dev/null
else
  pm2 start server.js --name "$PM2_NAME" >/dev/null
fi
pm2 save >/dev/null

if ! systemctl list-unit-files 2>/dev/null | grep -q '^pm2-root\.service'; then
  say "Enabling PM2 auto-start on boot"
  pm2 startup systemd -u root --hp /root >/dev/null 2>&1 \
    || warn "pm2 startup returned non-zero. Run 'pm2 startup' manually if needed."
fi

# ==== Final message =========================================================
IP=$(hostname -I 2>/dev/null | awk '{print $1}')
[ -z "${IP:-}" ] && IP="<host-ip>"
echo
ok "PVE Vitals is running"
printf '    Open     %shttp://%s:%s%s\n' "$C_G" "$IP" "$APP_PORT" "$C_N"
printf '    Logs     %spm2 logs %s%s\n'  "$C_D" "$PM2_NAME"       "$C_N"
printf '    Restart  %spm2 restart %s%s\n' "$C_D" "$PM2_NAME"     "$C_N"
printf '    Config   %s%s%s\n'            "$C_D" "$ENV_FILE"      "$C_N"
echo
