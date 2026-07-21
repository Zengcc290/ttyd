#!/usr/bin/env bash
set -euo pipefail

# Webterm / ttyd one-shot installer
# Installs to /opt/webterm and sets up user + systemd services.

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
INSTALL_DIR="${INSTALL_DIR:-/opt/webterm}"
WEBTERM_USER="${WEBTERM_USER:-webterm}"
WEBTERM_HOME="${WEBTERM_HOME:-/home/${WEBTERM_USER}}"
WEB_USER="${WEB_USER:-admin}"
WEB_PASS="${WEB_PASS:-}"
LINUX_PASS="${LINUX_PASS:-}"
SKIP_OPENRESTY="${SKIP_OPENRESTY:-0}"

need_root() {
  if [[ "${EUID}" -ne 0 ]]; then
    echo "请用 root 运行: sudo bash scripts/install.sh" >&2
    exit 1
  fi
}

rand_pass() {
  if command -v openssl >/dev/null 2>&1; then
    openssl rand -base64 18 | tr -d '=+/' | cut -c1-20
  else
    tr -dc 'A-Za-z0-9' </dev/urandom | head -c 20
  fi
}

need_root

if ! command -v python3 >/dev/null 2>&1; then
  echo "缺少 python3，请先安装。" >&2
  exit 1
fi
if ! command -v tmux >/dev/null 2>&1; then
  echo "缺少 tmux，正在尝试安装..."
  if command -v apt-get >/dev/null 2>&1; then
    apt-get update -y && apt-get install -y tmux openssl
  elif command -v dnf >/dev/null 2>&1; then
    dnf install -y tmux openssl
  else
    echo "请手动安装 tmux 后重试。" >&2
    exit 1
  fi
fi

ARCH="$(uname -m)"
if [[ "$ARCH" != "aarch64" && "$ARCH" != "arm64" ]]; then
  echo "警告: 自带 bin/ttyd 为 ARM aarch64 静态二进制。当前架构: $ARCH"
  echo "若服务无法启动，请替换 bin/ttyd 为对应架构版本。"
fi

WEB_PASS="${WEB_PASS:-$(rand_pass)}"
LINUX_PASS="${LINUX_PASS:-$(rand_pass)}"

echo "==> 创建用户 ${WEBTERM_USER}"
if ! id "${WEBTERM_USER}" >/dev/null 2>&1; then
  useradd -m -s /bin/bash "${WEBTERM_USER}"
fi
echo "${WEBTERM_USER}:${LINUX_PASS}" | chpasswd

echo "==> 安装文件到 ${INSTALL_DIR}"
mkdir -p "${INSTALL_DIR}"
rsync -a --delete \
  --exclude '.git' \
  --exclude 'examples' \
  --exclude 'scripts' \
  --exclude 'README.md' \
  --exclude '.gitignore' \
  "${ROOT_DIR}/" "${INSTALL_DIR}/"

mkdir -p "${INSTALL_DIR}"/{log,state,etc}
chmod 750 "${INSTALL_DIR}/etc"
chmod 755 "${INSTALL_DIR}/bin" "${INSTALL_DIR}/lib" "${INSTALL_DIR}/www"
chmod 755 "${INSTALL_DIR}/bin/"* "${INSTALL_DIR}/lib/"* || true

# credentials (root only)
cat > "${INSTALL_DIR}/etc/credentials" <<CREDS
WEB_USERNAME=${WEB_USER}
WEB_PASSWORD=${WEB_PASS}
LINUX_USERNAME=${WEBTERM_USER}
LINUX_PASSWORD=${LINUX_PASS}
CREDS
chmod 600 "${INSTALL_DIR}/etc/credentials"

# htpasswd for nginx basic auth
if command -v openssl >/dev/null 2>&1; then
  HASH="$(openssl passwd -apr1 "${WEB_PASS}")"
  printf '%s:%s\n' "${WEB_USER}" "${HASH}" > "${INSTALL_DIR}/etc/htpasswd"
else
  echo "警告: 无 openssl，无法生成 htpasswd，请稍后手动创建 ${INSTALL_DIR}/etc/htpasswd" >&2
  : > "${INSTALL_DIR}/etc/htpasswd"
fi
chmod 600 "${INSTALL_DIR}/etc/htpasswd"

# session state dir for webterm user
install -d -o "${WEBTERM_USER}" -g "${WEBTERM_USER}" -m 700 \
  "${WEBTERM_HOME}/.local/share/webterm-sessions"

# symlink for convenience
ln -sfn "${INSTALL_DIR}/bin/ttyd" /usr/local/bin/ttyd

echo "==> 安装 systemd 服务"
install -m 644 "${INSTALL_DIR}/systemd/webterm-manager.service" /etc/systemd/system/webterm-manager.service
install -m 644 "${INSTALL_DIR}/systemd/webterm.service" /etc/systemd/system/webterm.service
# rewrite paths if INSTALL_DIR differs
if [[ "${INSTALL_DIR}" != "/opt/webterm" ]]; then
  sed -i "s|/opt/webterm|${INSTALL_DIR}|g" /etc/systemd/system/webterm-manager.service /etc/systemd/system/webterm.service
fi
systemctl daemon-reload
systemctl enable --now webterm-manager.service webterm.service

echo "==> 检查服务"
sleep 1
systemctl --no-pager --full status webterm-manager.service webterm.service || true

if [[ "${SKIP_OPENRESTY}" != "1" && -x "${INSTALL_DIR}/bin/sync-openresty.sh" ]]; then
  if [[ -d /opt/1panel/www ]]; then
    echo "==> 检测到 1Panel OpenResty，同步前端与反代配置"
    "${INSTALL_DIR}/bin/sync-openresty.sh" || echo "sync-openresty 失败，可稍后手动执行"
  else
    echo "未检测到 /opt/1panel/www，跳过 OpenResty 同步。"
    echo "本地认证入口配置见: ${INSTALL_DIR}/nginx/webterm-local.conf (127.0.0.1:7682)"
  fi
fi

cat <<MSG

========================================
Webterm 安装完成（开箱即用）
========================================
安装目录: ${INSTALL_DIR}
账号文件: ${INSTALL_DIR}/etc/credentials  (仅 root 可读)

网页 Basic Auth:
  用户: ${WEB_USER}
  密码: ${WEB_PASS}

Linux 用户:
  用户: ${WEBTERM_USER}
  密码: ${LINUX_PASS}

本机端口:
  7681  ttyd (仅 127.0.0.1)
  7684  session manager API
  7682  OpenResty 本地认证入口（若已同步）

常用命令:
  systemctl status webterm webterm-manager
  systemctl restart webterm webterm-manager
  journalctl -u webterm -u webterm-manager -n 50 --no-pager
  ${INSTALL_DIR}/bin/sync-openresty.sh

注意: 自带 ttyd 二进制为 aarch64。x86_64 请替换 ${INSTALL_DIR}/bin/ttyd
MSG
