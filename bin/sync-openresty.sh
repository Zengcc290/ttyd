#!/usr/bin/env bash
set -euo pipefail
OPENRESTY_CONTAINER="${OPENRESTY_CONTAINER:-$(docker ps --filter 'name=^/1Panel-openresty-' --format '{{.Names}}' | head -n 1)}"
if [[ -z "${OPENRESTY_CONTAINER}" ]]; then
  echo "未找到运行中的 1Panel OpenResty 容器。" >&2
  exit 1
fi

cp -a /opt/webterm/www/. /opt/1panel/www/webterm-dashboard/
cp -a /opt/webterm/nginx/webterm-local.conf /opt/1panel/www/conf.d/webterm-local.conf
if [[ -d /opt/1panel/www/sites/webterm-zengcc/log ]]; then
  cp -a /opt/webterm/nginx/zengcc.cc.cd.conf /opt/1panel/www/conf.d/zengcc.cc.cd.conf
fi
if [ -f /opt/webterm/etc/htpasswd ]; then
  install -m 0600 /opt/webterm/etc/htpasswd /opt/1panel/www/conf.d/.webterm.htpasswd
fi
docker exec "${OPENRESTY_CONTAINER}" nginx -t
docker exec "${OPENRESTY_CONTAINER}" nginx -s reload
echo "openresty synced"
