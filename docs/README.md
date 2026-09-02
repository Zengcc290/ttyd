# Webterm (ttyd)

统一部署目录：`/opt/webterm`

## 目录结构

```
/opt/webterm/
  bin/ttyd                  # ttyd 二进制
  bin/webterm-session       # 会话附着脚本
  lib/webterm-manager.py    # 会话管理 API
  www/                      # 终端首页 + 触摸滚动脚本
  nginx/                    # OpenResty 配置源文件
  systemd/                  # systemd unit 源文件
  etc/htpasswd              # 网页 Basic Auth
  etc/credentials           # 账号说明（仅 root）
  etc/tmux.conf
  docs/README.md
```

运行时会话状态：`/home/webterm/.local/share/webterm-sessions`

## 服务

```bash
systemctl status webterm webterm-manager
systemctl restart webterm webterm-manager
journalctl -u webterm -u webterm-manager -n 50 --no-pager
```

## 访问

- 公网：https://zengcc.cc.cd
- 链路：香港 nginx/frps -> 内网 frpc -> OpenResty(Host zengcc.cc.cd) -> ttyd

## 端口

- 7681 ttyd（仅本机）
- 7682 openresty 公网认证入口（Basic Auth）
- 7684 session manager API（仅本机）

## 同步配置到 OpenResty

```bash
/opt/webterm/bin/sync-openresty.sh
```

账号见 `/opt/webterm/etc/credentials`。
