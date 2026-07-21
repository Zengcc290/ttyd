#!/usr/bin/env bash
set -euo pipefail
INSTALL_DIR="${INSTALL_DIR:-/opt/webterm}"
if [[ "${EUID}" -ne 0 ]]; then
  echo "请用 root 运行" >&2
  exit 1
fi
systemctl disable --now webterm.service webterm-manager.service 2>/dev/null || true
rm -f /etc/systemd/system/webterm.service /etc/systemd/system/webterm-manager.service
systemctl daemon-reload
rm -f /usr/local/bin/ttyd
echo "已停止服务。部署目录 ${INSTALL_DIR} 未删除，如需清理请手动 rm -rf ${INSTALL_DIR}"
