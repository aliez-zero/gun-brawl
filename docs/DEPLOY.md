# 部署手册（Docker + Caddy）

一条 `docker compose up -d` 起完整服务：Rust 游戏服务、DeepSeek 边车、Caddy（自动 HTTPS/WS）。
所有命令在服务器上的 `/srv/gun-brawl` 执行。

## 1. 前置条件

| 项 | 建议 |
| --- | --- |
| VPS | 2 vCPU / 4 GB / 40 GB SSD，Ubuntu 24.04 |
| 域名 | `play.example.com` 的 A/AAAA 记录指向服务器 |
| 防火墙 | 只开 22、80、443 |
| 镜像仓库 | GitHub Actions 推送到 GHCR；服务器需 `docker login ghcr.io`（只读 PAT） |

## 2. 首次上线

```bash
# 服务器
sudo apt update && sudo apt install -y docker.io docker-compose-v2
sudo usermod -aG docker deploy   # 重新登录后生效
docker login ghcr.io

sudo mkdir -p /srv/gun-brawl /srv/gun-brawl/logs
cd /srv/gun-brawl
# 放入 docker-compose.yml、Caddyfile、.env（权限 600）
cp .env.example .env && chmod 600 .env
# 编辑 .env：DOMAIN、IMAGE_PREFIX（ghcr.io/<owner>/gun-brawl）、TAG、可选 DEEPSEEK_API_KEY

docker compose up -d
curl -fsS https://play.example.com/healthz   # ok
```

`Caddyfile` 只监听容器网络的 8080/8090，宿主机只发布 80/443；证书由 Caddy 自动申请和续期。

## 3. 升级与回滚

```bash
# 升级（CI 已经推好镜像）
TAG=<commit-sha> docker compose pull && TAG=<commit-sha> docker compose up -d
curl -fsS https://$DOMAIN/healthz

# 回滚到上一个 sha
TAG=<previous-sha> docker compose up -d app
```

观察 10 分钟：`docker compose logs -f app`、tick 延迟与断线（P5 后接 Prometheus）。

## 4. 备份与恢复

SQLite 在 `data` 卷：

```bash
docker compose exec app sh -c 'mkdir -p /data/backup && sqlite3 /data/gunbrawl.db ".backup /data/backup/$(date +%F).db"'
# 恢复
docker compose stop app
docker compose run --rm -v gun-brawl_data:/data app sh -c 'cp /data/backup/<date>.db /data/gunbrawl.db'
docker compose start app
```

（当前 P2 还没有写库表，备份步骤先保留为约定。）

## 5. 监控与日志

- `docker compose logs -f app`：结构化日志（`RUST_LOG=info`），含房间与连接事件。
- Caddy 访问日志：`./logs/access.log`（JSON）。
- 健康检查：容器内 `gunbrawl-server --health` 连接 127.0.0.1:8080；失败时 compose 会重启。
- P5 后续：Prometheus 指标 `/metrics`、tick 延迟告警、房间数面板。

## 6. 排障

| 现象 | 检查 |
| --- | --- |
| 域名打不开 | DNS 是否生效；`docker compose logs caddy` |
| WebSocket 连不上 | Caddy 日志里是否有 101；`/ws` 代理是否走 8080 |
| 建房报 503 | 房间码分配失败或进程重启；看 app 日志 |
| DeepSeek 显示未配置 | `.env` 里 `DEEPSEEK_API_KEY`；`docker compose logs gateway` |
| 对局卡顿 | 看 tick 延迟日志；单实例容量约数百房（见 PERFORMANCE.md） |

## 7. 安全基线

- 密钥只放服务器 `.env`（600），不进镜像、不进 Git。
- 容器非 root（app 用户 uid 10001；gateway 用 `node` 用户）。
- 数据库卷与日志卷单独挂载。
- 公开前关闭 SSH 密码登录，只留密钥。
