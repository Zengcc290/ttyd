#!/usr/bin/env bash
set -euo pipefail
cp -a /opt/webterm/www/. /opt/1panel/www/webterm-dashboard/
cp -a /opt/webterm/nginx/webterm-local.conf /opt/1panel/www/conf.d/webterm-local.conf
cp -a /opt/webterm/nginx/zengcc.cc.cd.conf /opt/1panel/www/conf.d/zengcc.cc.cd.conf
if [ -f /opt/webterm/etc/htpasswd ]; then
  install -m 0600 /opt/webterm/etc/htpasswd /opt/1panel/www/conf.d/.webterm.htpasswd
fi
docker exec 1Panel-openresty-5bD6 nginx -t
docker exec 1Panel-openresty-5bD6 nginx -s reload
echo "openresty synced"
