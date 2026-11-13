# 荔枝新园 · PouhoSyun Blog

个人服务器上的博客与图文运营台。Node.js ≥20，零第三方运行时依赖，无构建步骤。以荔枝主图为视觉标识，采用奶油纸白、深棕与荔枝红配色，提供文章阅读、归档、分类、标签和在线图文编辑功能。

站名、简介、站点链接、头像和首页图片均可在运营台修改。首次启动不自动发布文章，上线前请检查站点信息。

## 功能与边界

- 服务端 HTML：首页、文章、归档、分类、标签、关于、RSS、站点地图。
- `/studio/` 网页运营台：密码验证，可选 TOTP；图文块排版、草稿与发布、图片上传、预览、站点设置。
- 图片支持 PNG、JPEG、GIF、WebP、AVIF，单文件限制 8MB；不接受上传 SVG。
- 数据保存在 `data/blog.json`，媒体保存在 `uploads/`，无需数据库。
- 单管理员、单 Node 进程。不要使用 PM2 cluster 或多副本共享 JSON 文件；需要多人协作、版本历史或大流量时应迁移数据库。
- 目前不提供访客评论、邮件登录、定时发布、图片病毒扫描或自动备份。阅读数是近似计数，不是独立访客分析。
- 本仓库的部署配置是模板，不代表已在你的服务器运行或完成安全审计。

## 本地运行

```bash
node --version # >=20
cp .env.example .env
npm run password
# 将输出的 BLOG_ADMIN_PASSWORD_HASH=... 写入 .env，删除 BLOG_ADMIN_PASSWORD
npm start
```

访问 `http://localhost:4180/`，后台 `http://localhost:4180/studio/`，账号默认 `admin`。无需 `npm install`。`npm run dev` 使用 Node 自带 watch 模式。

**不要将开发模式暴露到公网。** 未提供密码配置的开发模式使用 `admin / letmein`；该默认口令仅用于本地开发，生产模式强制设置密码或哈希。始终配置自己的强口令。`.env.example` 的密码也只是占位符。

## 管理员安全

`npm run password` 在终端无回显读取口令，生成随机盐的 scrypt 哈希。至少 16 字符，推荐密码管理器生成 24 字符以上随机口令。不将明文口令传入命令行参数。

`npm run totp` 生成 Base32 密钥与 otpauth URI。在验证器中手动添加，选择 SHA1、6 位、30 秒，把密钥写到 `.env` 的 `BLOG_ADMIN_TOTP_SECRET`。不要把密钥上传第三方二维码网站。离线保存恢复副本；本项目没有网页账号找回流程。更换密码或 TOTP 后重启，并清理旧登录会话（先停止服务、备份 JSON，再将其中 `adminSessions` 改为空数组）。

会话 Cookie 使用 HttpOnly、SameSite，生产 HTTPS 配置启用 Secure；写入接口校验会话及 CSRF token。登录限流、内容白名单清洗是基本防护，不替代服务器防火墙与更新。TOTP 依赖设备与服务器时间同步。

## 与 MoonShade 共存部署

沿用独立 Node 服务 + systemd + Nginx 的方式，但使用新的 **4180** 端口、`pouhosyun-blog` 服务和独立目录，不覆盖 MoonShade/MemoryMap 服务、端口或 Nginx 配置。不需要在公网防火墙开放 4180，仅放行 HTTP/HTTPS。

下面命令在服务器手动执行。先确认备份已有 Nginx 配置，并将项目源码上传至 `/opt/pouhosyun-blog`；不要上传本地 `.env`、测试数据、`node_modules`。

### 1. 系统用户和目录

```bash
sudo useradd --system --home-dir /opt/pouhosyun-blog --shell /usr/sbin/nologin blog
sudo mkdir -p /opt/pouhosyun-blog/data /opt/pouhosyun-blog/uploads
sudo chown -R root:blog /opt/pouhosyun-blog
sudo chmod -R g+rX /opt/pouhosyun-blog
sudo chown -R blog:blog /opt/pouhosyun-blog/data /opt/pouhosyun-blog/uploads
cd /opt/pouhosyun-blog
sudo cp .env.example .env
sudo chown root:blog .env
sudo chmod 640 .env
```

若 `blog` 用户已存在，跳过创建。代码应由 root 或部署账号持有，运行用户仅能写入 data 和 uploads。

### 2. 配置生产环境

编辑 `.env`，至少设置：

```dotenv
NODE_ENV=production
HOST=127.0.0.1
PORT=4180
TZ=Asia/Shanghai
BLOG_SITE_ORIGIN=https://blog.example.com
BLOG_ADMIN_USER=admin
BLOG_ADMIN_PASSWORD_HASH=scrypt:用生成结果替换
BLOG_ADMIN_TOTP_SECRET=用生成结果替换
BLOG_COOKIE_SECURE=1
BLOG_TRUST_PROXY=1
BLOG_DATA_FILE=data/blog.json
BLOG_UPLOAD_DIR=uploads
BLOG_PAGE_SIZE=8
```

删除 `BLOG_ADMIN_PASSWORD`，将 `blog.example.com` 替换为自己的域名。未配置 TOTP 时将该项留空，不要保留“用生成结果替换”文字。密码哈希也必须是实际脚本输出。

### 3. systemd

```bash
command -v node
node --version
```

检查 `deploy/blog.service` 的 `ExecStart`：模板是 `/usr/bin/node`，必须替换成服务器实际可供 `blog` 用户执行的 Node ≥20 路径。现有其他项目可能使用 `/root/.nvm/...`；本服务低权限用户且启用了 ProtectHome，**不能直接复用 root 私有 nvm 路径**。请安装系统级 Node 到 `/usr/bin` 或 `/usr/local/bin`。

```bash
sudo install -m 644 deploy/blog.service /etc/systemd/system/pouhosyun-blog.service
sudo systemctl daemon-reload
sudo systemctl enable --now pouhosyun-blog
sudo systemctl status pouhosyun-blog --no-pager
curl -I http://127.0.0.1:4180/
```

unit 文件里的 NODE_ENV、HOST、PORT 优先于 `.env`，改端口需同时更新 unit、`.env` 和 Nginx，并 daemon-reload。服务启动失败用 `sudo journalctl -u pouhosyun-blog -n 80 --no-pager` 排查。

### 4. Nginx 和 HTTPS

先把域名 DNS 指向服务器，再修改 `deploy/nginx.conf` 中的 `blog.example.com`。模板只新增一个 server，不删除原站点配置。

```bash
sudo install -m 644 deploy/nginx.conf /etc/nginx/sites-available/pouhosyun-blog
sudo ln -s /etc/nginx/sites-available/pouhosyun-blog /etc/nginx/sites-enabled/pouhosyun-blog
sudo nginx -t && sudo systemctl reload nginx
# 若未安装：使用服务器发行版支持的方式安装 certbot 与 nginx 插件
sudo certbot --nginx -d blog.example.com --redirect
sudo certbot renew --dry-run
```

只在 HTTPS 完成后登录后台。HTTP 阶段因 Secure Cookie 不会保留会话属预期行为。没有 sites-available 结构的发行版使用自己的 include 目录。若已有同域名配置，先合并，不创建冲突 server。

模板 Nginx 覆盖客户端传入的 X-Forwarded-For，并仅代理到 localhost；不要把启用了 `BLOG_TRUST_PROXY=1` 的应用端口暴露公网。使用 CDN 或多层代理时需要重新审查真实 IP 的可信链。

### 5. 更新和备份

更新时只替换源码，保留 `.env`、`data/`、`uploads/`；之后执行 `sudo systemctl restart pouhosyun-blog`。不要直接同步删除远端数据。无需迁移其他项目。

为避免 JSON 与图片跨时刻不一致，简单备份可短暂停止服务：

```bash
sudo systemctl stop pouhosyun-blog
# 将输出保存到仅管理员可访问的目录；其中包含后台会话及未发布草稿。
sudo tar -C /opt/pouhosyun-blog -czf /安全备份目录/blog-$(date +%F-%H%M%S).tar.gz data uploads .env
sudo systemctl start pouhosyun-blog
```

确保备份目录存在并设为 700，压缩包设为 600；备份应加密并异地保存。命令失败也需要恢复服务。恢复时停止服务、解压、恢复 data/uploads 所有权为 blog:blog、清理旧会话后启动。定期实际演练恢复，不只检查压缩包存在。

## Docker（可选替代 systemd）

```bash
docker build -t pouhosyun-blog .
docker volume create blog-data
docker volume create blog-uploads
docker run -d --name pouhosyun-blog --restart unless-stopped \
  --env-file .env -e NODE_ENV=production -e HOST=0.0.0.0 -e PORT=4180 \
  -p 127.0.0.1:4180:4180 \
  -v blog-data:/app/data -v blog-uploads:/app/uploads pouhosyun-blog
```

不要同时运行 Docker 和 systemd 占用同一端口。镜像以 node 非 root 用户运行；使用 bind mount 时需提前确保挂载目录的 UID/GID 写权限。镜像不含 `.env` 与运行数据；Nginx/HTTPS、安全环境变量及备份要求不变。

## 目录

- `server.mjs`：路由、身份验证入口、上传与页面服务。
- `lib/`：数据存储、文章块规范化、白名单清洗与 HTML 渲染。
- `public/`：公开样式和脚本、原创占位插画。
- `public/studio/`：运营台页面与编辑器。
- `scripts/password.mjs`、`scripts/totp.mjs`：离线生成管理员配置。
- `deploy/`：systemd 与 Nginx 示例。

## 上线核对

- 修改个人介绍、标题、占位链接和插画；发布一篇自己的测试文章后撤回检查。
- HTTPS 正常，Cookie Secure，强口令与 TOTP 有效。
- 未登录无法获取草稿或操作上传/发布；退出后权限失效。
- 手机浏览与图文预览正常；大图片限制符合服务器容量。
- 4180 不对公网开放；MoonShade 等旧服务仍正常。
- data、uploads、.env 已离线备份，恢复流程经过演练。
