# 腾讯云部署手册（CVM / 轻量应用服务器）

目标：一台腾讯云机器跑「Rust 游戏服务 + DeepSeek 边车 + Caddy（自动 HTTPS/WS）」，浏览器打开域名就能联机。

通用步骤见 [DEPLOY.md](./DEPLOY.md)；这份只写腾讯云特有的部分：备案、安全组、镜像拉取、无域名临时访问。

## 0. 先做三个决定

| 决定 | 选项 | 影响 |
| --- | --- | --- |
| 地域 | 大陆（广州/上海/北京/成都） | 绑域名**必须先 ICP 备案**，否则 80/443 被拦截；国内延迟最低（10–40 ms） |
| | 香港/新加坡/硅谷 | **免备案**，国内玩家 30–80 ms，可以直接上 HTTPS |
| 规格 | 2C4G / 40G SSD | 可以在服务器上直接构建镜像 |
| | 2C2G | 跑得动（运行时 < 300 MB），但构建 Rust 要开 swap，或改成 CI 构建后拉镜像 |
| 镜像来源 | 服务器本地构建 | 最省事，不依赖外网拉镜像（推荐） |
| | GHCR（CI 已推） | 大陆拉取慢、易断流 |
| | 腾讯云 TCR | 规范，但要改 CI 多推一份 |

## 1. 开端口（云平台 + 系统两层都要）

- **云平台**：轻量应用服务器在控制台「防火墙」；CVM 在「安全组 → 入站规则」。放行 TCP **22**（建议只放自己的出口 IP）、**80**、**443**。
- **系统内**：Ubuntu 默认 `ufw` 是关闭的；如果你开过，`sudo ufw allow 22,80,443/tcp`。

## 2. 域名与备案

**大陆节点**：

1. 域名实名认证 → 腾讯云备案（通常 1–20 个工作日，主体/域名/服务器三者要对应）。
2. 备案通过前，绑域名的 80/443 会被运营商拦截，先用 [§6B](#b-还没备案--不想绑域名临时) 的临时方案。
3. 解析：DNSPod 加 A 记录 `play` → 服务器公网 IP（IPv6 可选，加 AAAA）。

**香港/海外节点**：直接加 A 记录，无需备案。

## 3. 装 Docker（Ubuntu 24.04）

```bash
sudo apt update
sudo apt install -y docker.io docker-compose-v2
sudo systemctl enable --now docker
sudo usermod -aG docker $USER      # 重新登录后生效
docker compose version             # 需要 ≥ 2.24（下文用到 !override）
```

## 4. 取代码

大陆访问 GitHub 经常很慢，两种办法：

```bash
# A. 能连通就直接 clone
sudo git clone --depth 1 https://github.com/aliez-zero/gun-brawl.git /srv/gun-brawl

# B. 本地打包上传（最稳）
#    本地：git archive -o gun-brawl.tar HEAD
#    scp gun-brawl.tar root@<公网IP>:/tmp/
sudo mkdir -p /srv/gun-brawl
sudo tar -xf /tmp/gun-brawl.tar -C /srv/gun-brawl
```

## 5. 配置 .env

```bash
cd /srv/gun-brawl
cp .env.example .env
chmod 600 .env
```

要改的项：

| 变量 | 说明 |
| --- | --- |
| `DOMAIN` | `play.example.com`；无域名时见 §6 |
| `IMAGE_PREFIX` | 本地构建填 `gun-brawl`；用 GHCR 填 `ghcr.io/aliez-zero/gun-brawl` |
| `TAG` | `latest`，或具体 commit sha |
| `GUNBRAWL_DB` | 保持 `/data/gunbrawl.db`（数据卷内） |
| `DEEPSEEK_API_KEY` | 留空则生产环境隐藏 DeepSeek 模式；填了会启用边车 |

## 6. 启动

### A. 有域名、已备案（标准）

```bash
docker compose build          # 首次约 10–20 分钟（2 核）
docker compose up -d
docker compose ps
curl -fsS https://play.example.com/healthz     # 返回 ok
curl -s  https://play.example.com/metrics | head
```

Caddy 会自动申请并续期证书（需要 80 和 443 都通）。前端连的是同源 `/ws`，不用改任何构建参数。

### B. 还没备案 / 不想绑域名（临时）

把 Caddy 的 80 端口映射到宿主的 8080，用 IP 直连：

```yaml
# docker-compose.ip.yml
services:
  caddy:
    ports: !override ["8080:80"]
```

```bash
# .env 里：DOMAIN=:80
docker compose -f docker-compose.yml -f docker-compose.ip.yml up -d
# 浏览器访问 http://<公网IP>:8080
```

`DOMAIN=:80` 让 Caddy 走纯 HTTP（不申请证书），`/ws` 与 `/api/deepseek` 照常代理。安全组要额外放行 8080。
备案通过后把 `DOMAIN` 改回真实域名、去掉 `-f docker-compose.ip.yml` 重启即可。

### C. 连 Caddy 都不要

```yaml
# docker-compose.ip.yml
services:
  app:
    ports: ["8080:8080"]
```

`docker compose up -d app` → `http://<公网IP>:8080`。
代价：**DeepSeek 模式不可用**（`/api/deepseek` 是由 Caddy 转发给边车的），其余功能正常。

## 7. 镜像从哪来（大陆网络）

| 方案 | 用法 | 备注 |
| --- | --- | --- |
| 本地构建 | `docker compose build` | 不依赖外网；2C4G 够用，2C2G 需要 swap |
| GHCR | `docker login ghcr.io -u <user> -p <只读 PAT>` 后 `docker compose pull` | 大陆常年几十 KB/s，容易超时 |
| 腾讯云 TCR | `docker login ccr.ccs.tencentyun.com` | 内网拉取最快，需要在 CI 里多推一份镜像 |

2C2G 上构建 Rust 先加 swap，否则可能被 OOM 杀掉：

```bash
sudo fallocate -l 2G /swapfile && sudo chmod 600 /swapfile
sudo mkswap /swapfile && sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
```

## 8. 日常运维

```bash
# 升级
cd /srv/gun-brawl && git pull && docker compose build && docker compose up -d

# 回滚
git checkout <上一个 sha> && docker compose build && docker compose up -d

# 日志
docker compose logs -f app          # 结构化日志，含房间/连接事件
tail -f ./logs/access.log           # Caddy JSON 访问日志
```

镜像里的 `restart: unless-stopped` 已经覆盖开机自启，只要 Docker 服务开机启动即可。

**备份 SQLite**（运行时镜像里**没有** `sqlite3` 命令，别在 `app` 容器里直接调）：

```bash
# 停服拷贝（简单可靠）
docker compose stop app
docker compose cp app:/data/gunbrawl.db ./gunbrawl-$(date +%F).db
docker compose start app

# 不停服、WAL 安全（卷名以 docker volume ls 为准）
docker run --rm -v gun-brawl_data:/data keinos/sqlite3 \
  /data/gunbrawl.db ".backup /data/backup.db"
```

`/metrics` 是 Prometheus 文本格式，公网暴露会泄露房间数/连接数，介意的话在 Caddyfile 里给它单独加 `basic_auth` 或限制来源 IP。

## 9. 可选：GitHub Actions 自动部署

仓库自带 `.github/workflows/ci.yml`：`main` 推送后跑测试 → 构建镜像推 GHCR → SSH 到服务器 `docker compose pull && up -d`。

需要的 Secrets：

| Secret | 内容 |
| --- | --- |
| `DEPLOY_HOST` | 公网 IP 或域名 |
| `DEPLOY_SSH_KEY` | `deploy` 用户的私钥 |
| `DOMAIN` | 部署后 `curl /healthz` 用的域名 |

前提：服务器上有 `deploy` 用户和 `/srv/gun-brawl`，且**能拉 GHCR**。大陆节点这个前提经常不成立，那就删掉 `deploy` job，改成本地推代码 + 服务器上手动 `git pull && docker compose build`。

## 10. 容量与带宽

- 运行时内存约 200–300 MB；单核可承载数百房间（压测见 [PERFORMANCE.md](./PERFORMANCE.md)），实际瓶颈通常是带宽。
- 每客户端：快照 338 B × 30 Hz ≈ **10 KB/s 下行**；输入约 1 KB/s 上行。
- 4 人房 ≈ 40 KB/s 出向 ≈ 0.32 Mbps；轻量服务器常见的 1 TB/月流量包，够一间 4 人房 24/7 跑满一个月（约 100 GB）。

## 11. 排障

| 现象 | 检查 |
| --- | --- |
| 证书申请失败 | 80/443 是否都通；DNS 是否已生效；大陆节点是否已备案；`docker compose logs caddy` |
| 域名超时但 IP 能通 | 多半是备案没通过，被运营商拦了 |
| 页面能开、联机连不上 | Caddy 日志里有没有 `101`；`/ws` 是否反代到 `app:8080` |
| 建房报 503 | `docker compose logs app`，看房间码分配/进程重启 |
| DeepSeek 模式灰掉 | `.env` 的 `DEEPSEEK_API_KEY`；`docker compose logs gateway` |
| 容器反复重启 | `docker compose ps` 看健康状态；容器内 `gunbrawl-server --health` 连的是 `127.0.0.1:8080` |
| 对局卡顿 | `docker compose logs app` 看 tick；确认服务器不在被 CPU 挤占的突发型实例上 |

## 12. 备案拦截怎么判断

大陆节点上「域名打不开、但 `http://IP` 正常」几乎都是备案（接入）问题。腾讯云在入口处按域名拦截，与 Caddy 无关，用两条命令就能确认：

```bash
# 80 端口：被拦时会 302 到 dnspod.qcloud.com/static/webblock.html?d=<域名>
curl -i -H "Host: your.domain" http://<公网IP>/healthz

# 对照：随便一个不存在的域名能打到你自己的服务（证明机器没被封）
curl -o /dev/null -w '%{http_code}\n' -H "Host: not-a-real-host.cn" http://<公网IP>/healthz
```

443 端口更彻底：带该域名的 SNI 发起 TLS，拦截时在握手阶段就被 RST（`curl: (35) Recv failure: Connection was reset`），而同一台机器上 `curl --resolve your.domain:443:127.0.0.1 https://your.domain/` 是通的。

被拦时 ACME 两条验证都会失败，日志长这样：

| 验证 | 现象 |
| --- | --- |
| `http-01` | `Error reading HTTP response body: reader size limit exceeded`（拿到的是拦截页） |
| `tls-alpn-01` | `Connection reset by peer` |

**DNS-01 也救不回来**：证书能签下来，但 443 的 SNI 仍然被 RST，用户还是连不上。唯一解是完成备案接入（腾讯云控制台 → 备案），通常 1–3 个工作日；期间先用 `http://IP` 访问。

## 13. 切换到 HTTPS

备案通过后一条命令：

```bash
cd /srv/gun-brawl
./deploy/switch-https.sh your.domain
```

脚本会改 `.env` 的 `DOMAIN`、重启 Caddy、最多等 120 秒验证 `https://your.domain/healthz`，失败会自动回滚成 `DOMAIN=:80` 并把 Caddy 日志打出来。前端会根据 `location.protocol` 自动改用 `wss://`，不需要重新构建。

切换后 `http://<IP>` 会 302 到 `https://<IP>`（证书对不上），对外分享请用域名。

## 14. 备份与日志

**数据库备份**（SQLite 在 `data` 卷里；运行时镜像没有 `sqlite3`，所以用一次性容器做 WAL 安全的 `.backup`）：

```bash
cd /srv/gun-brawl
./deploy/backup-db.sh          # 输出到 ./backups/gunbrawl-YYYY-MM-DD.db，默认保留 14 天
```

放进 root 的 crontab，每天 04:00 跑一次：

```cron
0 4 * * * /srv/gun-brawl/deploy/backup-db.sh >> /srv/gun-brawl/backups/backup.log 2>&1
```

**日志轮转**：容器日志在 compose 里限了 `10m × 3` 文件；Caddy 访问日志在 `Caddyfile` 里用 `roll_size 10MiB` / `roll_keep 5`。改完需要 `docker compose up -d`（compose 文件变更会重建容器）和 `docker compose restart caddy`（Caddyfile 是 bind mount）。

## 15. 大陆网络下的构建加速

直连大陆机器构建时，`static.rust-lang.org` 会超时、`crates.io` 只有十几 KB/s，而 `server/rust-toolchain.toml` 钉的是 `stable`，rustup 必然去联网。仓库里的 Dockerfile 保持官方源（给 CI 用），在境内机器上构建时用一份本地副本加两行：

```dockerfile
FROM rust:1-bookworm AS chef
ENV RUSTUP_DIST_SERVER=https://mirrors.ustc.edu.cn/rust-static \
    RUSTUP_UPDATE_ROOT=https://mirrors.ustc.edu.cn/rust-static/rustup
RUN printf '[source.crates-io]\nreplace-with = "ustc"\n[source.ustc]\nregistry = "sparse+https://mirrors.ustc.edu.cn/crates.io-index/"\n' > "$CARGO_HOME/config.toml"
```

实测 USTC 镜像 4.7 MB/s，构建时间从「不可用」降到 10 分钟以内。

