# ttyd / Webterm

一键部署的多会话浏览器终端（ttyd + tmux + 会话管理 + 可选 OpenResty 反代）。

私人仓库备份，目标：**克隆后执行安装脚本即可开箱使用**。

## 功能

- 浏览器多会话终端（tmux 持久化）
- 会话管理 API（创建 / 列表 / 删除 / 空闲清理）
- 触摸滚动增强（`www/terminal-touch-scroll.js`）
- systemd 托管（`webterm` + `webterm-manager`）
- 可选 1Panel OpenResty 同步（Basic Auth + WebSocket 反代）

## 目录结构

```text
bin/ttyd                 # ttyd 静态二进制（ARM aarch64）
bin/webterm-session      # 按会话 ID 附着 tmux
bin/sync-openresty.sh    # 同步到 1Panel OpenResty
lib/webterm-manager.py   # 会话管理 HTTP API (:7684)
www/                     # 首页与前端脚本
nginx/                   # OpenResty / 本地反代配置
systemd/                 # unit 文件
etc/tmux.conf            # tmux 配置
examples/                # 凭证示例（不含真实密码）
scripts/install.sh       # 一键安装
scripts/uninstall.sh     # 卸载服务
```

## 系统要求

- Linux + systemd
- root 权限
- `python3`、`tmux`（安装脚本可尝试 apt/dnf 安装）
- **二进制架构：当前 `bin/ttyd` 为 aarch64**。x86_64 需自行替换兼容的 ttyd

## 一键安装

```bash
git clone git@github.com:Zengcc290/ttyd.git
cd ttyd
sudo bash scripts/install.sh
```

可选环境变量：

```bash
sudo WEB_USER=admin WEB_PASS='你的网页密码' LINUX_PASS='webterm用户密码' \
  WEBTERM_FORCE_UNLOCK_SECRET='强制解锁密文' bash scripts/install.sh
# 不自动同步 OpenResty:
sudo SKIP_OPENRESTY=1 bash scripts/install.sh
# 使用系统中与当前架构兼容的 ttyd:
sudo TTYD_BIN=/usr/bin/ttyd bash scripts/install.sh
```

安装完成后：

- 账号写在 `/opt/webterm/etc/credentials`（仅 root）
- 服务自动 enable + start
- 端口：`7681` ttyd（仅本机）、`7684` API（仅本机）、`7682` 公网认证入口（若同步了 OpenResty）

## 常用运维

```bash
systemctl status webterm webterm-manager
systemctl restart webterm webterm-manager
journalctl -u webterm -u webterm-manager -n 80 --no-pager
/opt/webterm/bin/sync-openresty.sh
```

## 访问链路（当前生产）

- 公网域名示例：`https://zengcc.cc.cd`
- 链路：边缘 nginx/frp → 内网 OpenResty → ttyd(`127.0.0.1:7681`)
- 公网直连入口：`http://<服务器公网 IP>:7682/`（需 Basic Auth）

## 安全说明

- **真实密码不会进入本仓库**（`etc/credentials` / `etc/htpasswd` 已 gitignore）
- 安装脚本每次可生成新密码
- ttyd 和会话管理 API 仍只监听 `127.0.0.1`；公网 `7682` 入口保留 Basic Auth

## 卸载

```bash
sudo bash scripts/uninstall.sh
# 可选: sudo rm -rf /opt/webterm
```

## 版本

- ttyd: `1.7.7-40e79c7`（本机 `/opt/webterm/bin/ttyd`）

## 终端互斥锁 / 复制粘贴 / 缩放

- 首页点击“继续”时由后端原子加锁；终端页面和 WebSocket 握手都会再次校验锁令牌
- 锁在终端页打开后一直保留，关闭页面会尝试自动释放；浏览器崩溃或网络中断时不会凭超时回收，可用强制解锁断开旧终端连接
- 强制解锁密文默认为 `060806`，也可通过 `WEBTERM_FORCE_UNLOCK_SECRET` 指定；安装后见 `/opt/webterm/etc/credentials`
- 终端页右上角悬浮按钮：🔍 缩放、⎘ 复制模式、📋 粘贴弹窗
- 终端页右上角透明键盘按钮：可发送功能键、方向键、导航键和 Ctrl/Alt/Shift/Meta 组合键；展开时自动缩短终端区域，命令行输入框不会被面板遮挡
- 复制模式会禁用触摸滚动；退出后恢复
