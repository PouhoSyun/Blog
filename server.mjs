import { createServer } from "node:http";
import { createReadStream, readFileSync } from "node:fs";
import { stat } from "node:fs/promises";
import { extname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import crypto from "node:crypto";

import { Store } from "./lib/store.mjs";
import {
  CHALLENGE_TTL_MS,
  SESSION_TTL_MS,
  base32Encode,
  constantTimeEqual,
  createRateLimiter,
  findSession,
  hashPassword,
  parseCookies,
  pruneSessions,
  randomToken,
  serializeCookie,
  verifyPassword,
  verifyTotp
} from "./lib/auth.mjs";
import { cleanText, normalizeBlocks, renderBlocks as renderBlocksForPreview, safeHref, safeImageSrc } from "./lib/content.mjs";
import {
  CATEGORIES,
  categoryCounts,
  normalizePost,
  postByPath,
  postDate,
  postPath,
  publishedPosts,
  searchIndex,
  tagCloud
} from "./lib/posts.mjs";
import {
  renderAbout,
  renderArchive,
  renderFeed,
  renderHome,
  renderList,
  renderNotFound,
  renderPostPage,
  renderSitemap,
  renderTagIndex
} from "./lib/views.mjs";
import { MAX_UPLOAD_BYTES, decodeDataUrl, listImages, removeImage, saveImage } from "./lib/uploads.mjs";

const __dirname = fileURLToPath(new URL(".", import.meta.url));

function loadEnvFile(file) {
  let raw = "";
  try {
    raw = readFileSync(file, "utf8");
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    return;
  }
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match) continue;
    const [, key, rawValue] = match;
    if (process.env[key] !== undefined) continue;
    let value = rawValue.trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
}

loadEnvFile(join(__dirname, ".env"));

const PUBLIC_DIR = join(__dirname, "public");
const UPLOAD_DIR = resolve(process.env.BLOG_UPLOAD_DIR || join(__dirname, "uploads"));
const DATA_FILE = resolve(process.env.BLOG_DATA_FILE || join(__dirname, "data", "blog.json"));
const PORT = Number(process.env.PORT || 4180);
const HOST = process.env.HOST || "127.0.0.1";
const IS_PRODUCTION = process.env.NODE_ENV === "production";
const SITE_ORIGIN = (process.env.BLOG_SITE_ORIGIN || `http://localhost:${PORT}`).replace(/\/$/, "");
const ADMIN_USER = (process.env.BLOG_ADMIN_USER || "admin").trim();
const ADMIN_PASSWORD_HASH = (process.env.BLOG_ADMIN_PASSWORD_HASH || "").trim();
const ADMIN_PASSWORD = process.env.BLOG_ADMIN_PASSWORD || (IS_PRODUCTION ? "" : "letmein");
const ADMIN_TOTP_SECRET = (process.env.BLOG_ADMIN_TOTP_SECRET || "").replace(/\s+/g, "").toUpperCase();
const COOKIE_SECURE = process.env.BLOG_COOKIE_SECURE === "1" || (IS_PRODUCTION && SITE_ORIGIN.startsWith("https://"));
const POSTS_PER_PAGE = Math.max(1, Math.min(50, Number(process.env.BLOG_PAGE_SIZE) || 8));
const TRUST_PROXY = process.env.BLOG_TRUST_PROXY === "1";

if (IS_PRODUCTION && !ADMIN_PASSWORD_HASH && !process.env.BLOG_ADMIN_PASSWORD) {
  throw new Error("生产环境必须设置 BLOG_ADMIN_PASSWORD_HASH（推荐）或 BLOG_ADMIN_PASSWORD。");
}

const PASSWORD_RECORD = ADMIN_PASSWORD_HASH || (ADMIN_PASSWORD ? hashPassword(ADMIN_PASSWORD) : "");
const store = new Store(DATA_FILE);
const limiter = createRateLimiter();

const CONTENT_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".txt": "text/plain; charset=utf-8",
  ".xml": "application/xml; charset=utf-8"
};

function baseHeaders(extra = {}) {
  return {
    "x-content-type-options": "nosniff",
    "referrer-policy": "strict-origin-when-cross-origin",
    "x-frame-options": "DENY",
    "permissions-policy": "camera=(), microphone=(), geolocation=()",
    ...(COOKIE_SECURE ? { "strict-transport-security": "max-age=31536000; includeSubDomains" } : {}),
    ...extra
  };
}

// 自渲染页面不需要外部脚本，CSP 关掉内联脚本之外的一切来源。
const CSP = [
  "default-src 'self'",
  "img-src 'self' data: https:",
  "style-src 'self' 'unsafe-inline'",
  "script-src 'self'",
  "font-src 'self' data:",
  "connect-src 'self'",
  "frame-ancestors 'none'",
  "base-uri 'none'",
  "form-action 'self'"
].join("; ");

function sendHtml(res, status, html, extra = {}) {
  const body = Buffer.from(html, "utf8");
  res.writeHead(status, baseHeaders({
    "content-type": "text/html; charset=utf-8",
    "content-security-policy": CSP,
    "content-length": body.length,
    "cache-control": "no-cache",
    ...extra
  }));
  res.end(body);
}

function sendText(res, status, text, type = "text/plain; charset=utf-8", extra = {}) {
  const body = Buffer.from(text, "utf8");
  res.writeHead(status, baseHeaders({ "content-type": type, "content-length": body.length, ...extra }));
  res.end(body);
}

function sendJson(res, status, payload, extra = {}) {
  const body = Buffer.from(JSON.stringify(payload), "utf8");
  res.writeHead(status, baseHeaders({
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "content-length": body.length,
    ...extra
  }));
  res.end(body);
}

function redirect(res, location, status = 302) {
  res.writeHead(status, baseHeaders({ location }));
  res.end();
}

function clientIp(req) {
  if (TRUST_PROXY) {
    const forwarded = String(req.headers["x-forwarded-for"] || "").split(",")[0].trim();
    if (forwarded) return forwarded;
    const real = String(req.headers["x-real-ip"] || "").trim();
    if (real) return real;
  }
  return req.socket.remoteAddress || "unknown";
}

function readBody(req, limit = MAX_UPLOAD_BYTES + 2 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", chunk => {
      size += chunk.length;
      if (size > limit) {
        req.destroy();
        reject(new Error("请求体过大。"));
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

async function readJsonBody(req) {
  const raw = (await readBody(req)).toString("utf8");
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    throw new Error("请求体不是合法 JSON。");
  }
}

function sameOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return true;
  const allowed = new Set([SITE_ORIGIN, `https://${req.headers.host}`, `http://${req.headers.host}`]);
  for (const extra of String(process.env.BLOG_ALLOWED_ORIGINS || "").split(",")) {
    const trimmed = extra.trim();
    if (trimmed) allowed.add(trimmed.replace(/\/$/, ""));
  }
  return allowed.has(origin.replace(/\/$/, ""));
}

function currentSession(req) {
  const cookies = parseCookies(req.headers.cookie);
  const session = findSession(store.data, cookies.blog_session);
  if (!session) return null;
  return { session, cookies };
}

// 写操作要求：同源 + 会话 cookie + 双提交 CSRF 令牌。
function requireAdmin(req, res, { csrf = true } = {}) {
  if (!sameOrigin(req)) {
    sendJson(res, 403, { error: "请求来源不被允许。" });
    return null;
  }
  const found = currentSession(req);
  if (!found) {
    sendJson(res, 401, { error: "请先登录运营台。" });
    return null;
  }
  if (csrf) {
    const header = String(req.headers["x-csrf-token"] || "");
    if (!header || !constantTimeEqual(header, found.session.csrf)) {
      sendJson(res, 403, { error: "CSRF 校验失败，请刷新页面重新登录。" });
      return null;
    }
  }
  return found.session;
}

function normalizeSite(input, existing) {
  const links = (Array.isArray(input.links) ? input.links : [])
    .slice(0, 8)
    .map(item => ({ label: cleanText(item?.label, 40), href: safeHref(item?.href) }))
    .filter(item => item.label && item.href);
  const heroLines = (Array.isArray(input.heroLines) ? input.heroLines : [])
    .slice(0, 6)
    .map(line => cleanText(line, 120))
    .filter(Boolean);
  const accent = /^#[0-9a-fA-F]{6}$/.test(String(input.accent || "")) ? input.accent : existing.accent;
  return {
    ...existing,
    title: cleanText(input.title, 80) || existing.title,
    subtitle: cleanText(input.subtitle, 120),
    description: cleanText(input.description, 300) || existing.description,
    author: cleanText(input.author, 60) || existing.author,
    language: /^[a-zA-Z-]{2,12}$/.test(String(input.language || "")) ? input.language : existing.language,
    heroHeading: cleanText(input.heroHeading, 60) || existing.heroHeading,
    heroLines: heroLines.length ? heroLines : existing.heroLines,
    heroImage: safeImageSrc(input.heroImage) || existing.heroImage,
    avatar: safeImageSrc(input.avatar) || existing.avatar,
    accent,
    footerNote: cleanText(input.footerNote, 200),
    links: links.length ? links : existing.links,
    aboutBlocks: input.aboutBlocks ? normalizeBlocks(input.aboutBlocks) : existing.aboutBlocks
  };
}

function postSummaryForStudio(post) {
  return {
    id: post.id,
    slug: post.slug,
    title: post.title,
    subtitle: post.subtitle,
    category: post.category,
    tags: post.tags,
    status: post.status,
    pinned: post.pinned,
    cover: post.cover,
    summary: post.summary,
    updatedAt: post.updatedAt,
    publishedAt: post.publishedAt,
    stats: post.stats,
    url: postPath(post),
    views: store.data.pageViews[post.id] || 0
  };
}

async function handleAuth(req, res, url) {
  if (req.method === "POST" && url.pathname === "/api/auth/login") {
    if (!sameOrigin(req)) return sendJson(res, 403, { error: "请求来源不被允许。" });
    const ip = clientIp(req);
    const gate = limiter.hit(`login:${ip}`, 8, 10 * 60_000);
    if (!gate.allowed) {
      return sendJson(res, 429, { error: `尝试过于频繁，请 ${Math.ceil(gate.retryAfterMs / 1000)} 秒后再试。` });
    }
    const body = await readJsonBody(req);
    const user = String(body.user || "").trim();
    const password = String(body.password || "");
    const code = String(body.code || "");
    const okUser = user.length > 0 && user.length < 80 && constantTimeEqual(user.padEnd(80, "\u0000").slice(0, 80), ADMIN_USER.padEnd(80, "\u0000").slice(0, 80));
    const okPassword = PASSWORD_RECORD ? verifyPassword(password, PASSWORD_RECORD) : false;
    if (!okUser || !okPassword) {
      return sendJson(res, 401, { error: "账号或口令不正确。" });
    }
    if (ADMIN_TOTP_SECRET) {
      if (!code) return sendJson(res, 401, { error: "请输入动态验证码。", needsTotp: true });
      if (!verifyTotp(ADMIN_TOTP_SECRET, code)) return sendJson(res, 401, { error: "动态验证码不正确。", needsTotp: true });
    }
    const session = {
      id: crypto.randomUUID(),
      token: randomToken(),
      csrf: randomToken(16),
      ip,
      userAgent: String(req.headers["user-agent"] || "").slice(0, 200),
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + SESSION_TTL_MS).toISOString()
    };
    await store.update(data => {
      pruneSessions(data);
      data.adminSessions.push(session);
      data.adminSessions = data.adminSessions.slice(-20);
      store.log("login", `${ip} ${session.userAgent}`);
    });
    limiter.reset(`login:${ip}`);
    const maxAge = Math.floor(SESSION_TTL_MS / 1000);
    return sendJson(res, 200, { ok: true, csrf: session.csrf, expiresAt: session.expiresAt, totpEnabled: Boolean(ADMIN_TOTP_SECRET) }, {
      "set-cookie": [
        serializeCookie("blog_session", session.token, { maxAge, secure: COOKIE_SECURE }),
        serializeCookie("blog_csrf", session.csrf, { maxAge, secure: COOKIE_SECURE, httpOnly: false })
      ]
    });
  }

  if (req.method === "POST" && url.pathname === "/api/auth/logout") {
    if (!requireAdmin(req, res)) return true;
    const found = currentSession(req);
    if (found) {
      await store.update(data => {
        data.adminSessions = data.adminSessions.filter(item => item.id !== found.session.id);
        store.log("logout", found.session.ip);
      });
    }
    return sendJson(res, 200, { ok: true }, {
      "set-cookie": [
        serializeCookie("blog_session", "", { maxAge: 0, secure: COOKIE_SECURE }),
        serializeCookie("blog_csrf", "", { maxAge: 0, secure: COOKIE_SECURE, httpOnly: false })
      ]
    });
  }

  if (req.method === "GET" && url.pathname === "/api/auth/session") {
    const found = currentSession(req);
    return sendJson(res, 200, {
      authenticated: Boolean(found),
      totpEnabled: Boolean(ADMIN_TOTP_SECRET),
      csrf: found?.session.csrf || "",
      expiresAt: found?.session.expiresAt || ""
    });
  }

  // 辅助生成 TOTP 密钥，只在本地开发模式开放。
  if (req.method === "POST" && url.pathname === "/api/auth/totp-secret") {
    if (IS_PRODUCTION) return sendJson(res, 403, { error: "生产环境不提供密钥生成，请用 npm run totp。" });
    const secret = base32Encode(crypto.randomBytes(20));
    const label = encodeURIComponent(`${store.data.site.title}:${ADMIN_USER}`);
    return sendJson(res, 200, {
      secret,
      otpauth: `otpauth://totp/${label}?secret=${secret}&issuer=${encodeURIComponent(store.data.site.title)}&algorithm=SHA1&digits=6&period=30`
    });
  }

  return null;
}

async function handleStudioApi(req, res, url) {
  if (req.method === "GET" && url.pathname === "/api/studio/bootstrap") {
    const session = requireAdmin(req, res, { csrf: false });
    if (!session) return true;
    const posts = [...store.data.posts].sort((a, b) => (b.updatedAt || "").localeCompare(a.updatedAt || ""));
    const published = publishedPosts(store.data);
    return sendJson(res, 200, {
      site: store.data.site,
      categories: CATEGORIES,
      posts: posts.map(postSummaryForStudio),
      images: await listImages(UPLOAD_DIR, 120),
      stats: {
        total: store.data.posts.length,
        published: published.length,
        drafts: store.data.posts.length - published.length,
        words: store.data.posts.reduce((sum, post) => sum + (post.stats?.words || 0), 0),
        views: Object.values(store.data.pageViews).reduce((sum, value) => sum + value, 0)
      },
      audit: store.data.auditLog.slice(0, 20)
    });
  }

  const postMatch = /^\/api\/studio\/posts\/([A-Za-z0-9-]{1,40})$/.exec(url.pathname);
  if (req.method === "GET" && postMatch) {
    const session = requireAdmin(req, res, { csrf: false });
    if (!session) return true;
    const post = store.data.posts.find(item => item.id === postMatch[1]);
    if (!post) return sendJson(res, 404, { error: "文稿不存在。" });
    return sendJson(res, 200, { post });
  }

  if (req.method === "POST" && url.pathname === "/api/studio/posts") {
    const session = requireAdmin(req, res);
    if (!session) return true;
    const body = await readJsonBody(req);
    const result = await store.update(data => {
      const existing = body.id ? data.posts.find(item => item.id === body.id) : null;
      if (body.id && !existing) throw new Error("文稿不存在，可能已被删除。");
      const post = normalizePost(body, existing || {});
      if (data.posts.some(item => item.slug === post.slug && item.id !== post.id)) {
        throw new Error(`路径 ${post.slug} 已被其他文稿占用。`);
      }
      if (existing) {
        data.posts[data.posts.indexOf(existing)] = post;
      } else {
        data.posts.push(post);
      }
      store.log(existing ? "post.update" : "post.create", `${post.status} ${post.slug}`);
      return post;
    });
    return sendJson(res, 200, { ok: true, post: result, url: postPath(result) });
  }

  if (req.method === "POST" && url.pathname === "/api/studio/posts/delete") {
    const session = requireAdmin(req, res);
    if (!session) return true;
    const body = await readJsonBody(req);
    const removed = await store.update(data => {
      const post = data.posts.find(item => item.id === body.id);
      if (!post) throw new Error("文稿不存在。");
      data.posts = data.posts.filter(item => item.id !== body.id);
      store.log("post.delete", post.slug);
      return post;
    });
    return sendJson(res, 200, { ok: true, removed: removed.slug });
  }

  if (req.method === "POST" && url.pathname === "/api/studio/posts/status") {
    const session = requireAdmin(req, res);
    if (!session) return true;
    const body = await readJsonBody(req);
    const post = await store.update(data => {
      const target = data.posts.find(item => item.id === body.id);
      if (!target) throw new Error("文稿不存在。");
      if (body.status === "published" || body.status === "draft") {
        target.status = body.status;
        if (body.status === "published" && !target.publishedAt) target.publishedAt = new Date().toISOString();
      }
      if (typeof body.pinned === "boolean") target.pinned = body.pinned;
      target.updatedAt = new Date().toISOString();
      store.log("post.status", `${target.slug} -> ${target.status}${target.pinned ? " pinned" : ""}`);
      return target;
    });
    return sendJson(res, 200, { ok: true, post: postSummaryForStudio(post) });
  }

  if (req.method === "POST" && url.pathname === "/api/studio/site") {
    const session = requireAdmin(req, res);
    if (!session) return true;
    const body = await readJsonBody(req);
    const site = await store.update(data => {
      data.site = normalizeSite(body, data.site);
      store.log("site.update", data.site.title);
      return data.site;
    });
    return sendJson(res, 200, { ok: true, site });
  }

  if (req.method === "POST" && url.pathname === "/api/studio/uploads") {
    const session = requireAdmin(req, res);
    if (!session) return true;
    const gate = limiter.hit(`upload:${session.id}`, 120, 10 * 60_000);
    if (!gate.allowed) return sendJson(res, 429, { error: "上传过于频繁，请稍后再试。" });
    const body = await readJsonBody(req);
    const decoded = decodeDataUrl(body.dataUrl);
    if (!decoded) return sendJson(res, 400, { error: `图片无法读取，或超过 ${Math.floor(MAX_UPLOAD_BYTES / 1024 / 1024)}MB 上限。` });
    const saved = await saveImage(UPLOAD_DIR, decoded.buffer, { prefix: body.prefix || "img" });
    await store.update(() => store.log("upload", `${saved.url} ${saved.bytes}B`));
    return sendJson(res, 200, { ok: true, ...saved });
  }

  if (req.method === "POST" && url.pathname === "/api/studio/uploads/delete") {
    const session = requireAdmin(req, res);
    if (!session) return true;
    const body = await readJsonBody(req);
    await removeImage(UPLOAD_DIR, body.url);
    await store.update(() => store.log("upload.delete", String(body.url).slice(0, 200)));
    return sendJson(res, 200, { ok: true });
  }

  if (req.method === "GET" && url.pathname === "/api/studio/uploads") {
    const session = requireAdmin(req, res, { csrf: false });
    if (!session) return true;
    return sendJson(res, 200, { images: await listImages(UPLOAD_DIR, 200) });
  }

  // 预览用服务端同一套渲染逻辑，避免编辑器与正文效果不一致。
  if (req.method === "POST" && url.pathname === "/api/studio/preview") {
    const session = requireAdmin(req, res);
    if (!session) return true;
    const body = await readJsonBody(req);
    const post = normalizePost({ ...body, status: "draft" }, {});
    const rendered = renderBlocksForPreview(post.blocks);
    return sendJson(res, 200, { html: rendered.html, toc: rendered.toc, stats: post.stats, summary: post.summary });
  }

  return false;
}

function siteStats(posts) {
  return {
    posts: posts.length,
    words: posts.reduce((sum, post) => sum + (post.stats?.words || 0), 0),
    tags: tagCloud(posts).length,
    categories: categoryCounts(posts),
    tagList: tagCloud(posts)
  };
}

function paginate(posts, page) {
  const totalPages = Math.max(1, Math.ceil(posts.length / POSTS_PER_PAGE));
  const current = Math.min(Math.max(1, page), totalPages);
  return { items: posts.slice((current - 1) * POSTS_PER_PAGE, current * POSTS_PER_PAGE), page: current, totalPages };
}

const viewBuffer = new Map();

// 阅读计数：同一 IP 对同一篇文稿 6 小时内只计一次，并批量落盘。
function countView(postId, ip) {
  const key = `${postId}:${crypto.createHash("sha256").update(String(ip)).digest("hex").slice(0, 16)}`;
  const now = Date.now();
  if (viewBuffer.get(key) && now - viewBuffer.get(key) < 6 * 60 * 60_000) return;
  viewBuffer.set(key, now);
  if (viewBuffer.size > 20000) viewBuffer.clear();
  store.update(data => {
    data.pageViews[postId] = (data.pageViews[postId] || 0) + 1;
  }).catch(() => {});
}

function handlePages(req, res, url) {
  const site = store.data.site;
  const posts = publishedPosts(store.data);
  const path = url.pathname;

  if (path === "/" || /^\/page\/\d+\/?$/.test(path)) {
    const page = path === "/" ? 1 : Number(path.split("/")[2]);
    const { items, page: current, totalPages } = paginate(posts, page);
    if (current !== page && path !== "/") return redirect(res, current === 1 ? "/" : `/page/${current}/`);
    return sendHtml(res, 200, renderHome({ site, posts: items, page: current, totalPages, stats: siteStats(posts) }));
  }

  const postRoute = /^\/posts\/(\d{4})\/(\d{2})\/([a-z0-9-]{1,80})\/?$/.exec(path);
  if (postRoute) {
    const post = postByPath(store.data, postRoute[3]);
    if (!post) return sendHtml(res, 404, renderNotFound({ site }));
    const canonical = postPath(post);
    if (canonical !== (path.endsWith("/") ? path : `${path}/`)) return redirect(res, canonical, 301);
    const index = posts.findIndex(item => item.id === post.id);
    countView(post.id, clientIp(req));
    return sendHtml(res, 200, renderPostPage({
      site,
      post,
      prev: posts[index + 1] || null,
      next: index > 0 ? posts[index - 1] : null,
      views: store.data.pageViews[post.id] || 1
    }), { link: `<${SITE_ORIGIN}${canonical}>; rel="canonical"` });
  }

  if (path === "/archive" || path === "/archive/") {
    return sendHtml(res, 200, renderArchive({ site, posts }));
  }

  if (path === "/tags" || path === "/tags/") {
    return sendHtml(res, 200, renderTagIndex({ site, posts }));
  }

  const tagRoute = /^\/tags\/([^/]+)\/?(?:page\/(\d+)\/?)?$/.exec(path);
  if (tagRoute) {
    const tag = decodeURIComponent(tagRoute[1]);
    const filtered = posts.filter(post => post.tags.includes(tag));
    if (!filtered.length) return sendHtml(res, 404, renderNotFound({ site }));
    const { items, page, totalPages } = paginate(filtered, Number(tagRoute[2] || 1));
    return sendHtml(res, 200, renderList({
      site,
      heading: `#${tag}`,
      lead: `共 ${filtered.length} 篇带有该标签的文章。`,
      posts: items,
      base: `/tags/${encodeURIComponent(tag)}/`,
      page,
      totalPages
    }));
  }

  const catRoute = /^\/categories\/([^/]+)\/?(?:page\/(\d+)\/?)?$/.exec(path);
  if (catRoute) {
    const category = decodeURIComponent(catRoute[1]);
    const filtered = posts.filter(post => post.category === category);
    if (!filtered.length) return sendHtml(res, 404, renderNotFound({ site }));
    const { items, page, totalPages } = paginate(filtered, Number(catRoute[2] || 1));
    return sendHtml(res, 200, renderList({
      site,
      heading: category,
      lead: `分类下共 ${filtered.length} 篇文章。`,
      posts: items,
      base: `/categories/${encodeURIComponent(category)}/`,
      page,
      totalPages
    }));
  }

  if (path === "/about" || path === "/about/") {
    return sendHtml(res, 200, renderAbout({ site }));
  }

  if (path === "/feed.xml") {
    return sendText(res, 200, renderFeed({ site, posts, origin: SITE_ORIGIN }), "application/rss+xml; charset=utf-8", {
      "cache-control": "public, max-age=600"
    });
  }

  if (path === "/sitemap.xml") {
    return sendText(res, 200, renderSitemap({ posts, origin: SITE_ORIGIN }), "application/xml; charset=utf-8", {
      "cache-control": "public, max-age=3600"
    });
  }

  if (path === "/robots.txt") {
    return sendText(res, 200, `User-agent: *\nDisallow: /studio/\nDisallow: /api/\nSitemap: ${SITE_ORIGIN}/sitemap.xml\n`);
  }

  if (path === "/search.json") {
    return sendJson(res, 200, { posts: searchIndex(posts) }, { "cache-control": "public, max-age=120" });
  }

  return false;
}

async function serveFile(res, filePath, { immutable = false, csp = false } = {}) {
  const info = await stat(filePath);
  if (!info.isFile()) throw new Error("not a file");
  const ext = extname(filePath).toLowerCase();
  res.writeHead(200, baseHeaders({
    "content-type": CONTENT_TYPES[ext] || "application/octet-stream",
    "content-length": info.size,
    "cache-control": immutable ? "public, max-age=31536000, immutable" : "public, max-age=300",
    ...(csp ? { "content-security-policy": CSP } : {})
  }));
  createReadStream(filePath).pipe(res);
  return true;
}

async function serveStatic(req, res, url) {
  const decoded = decodeURIComponent(url.pathname);
  if (decoded.includes("\u0000")) return false;

  if (decoded.startsWith("/uploads/")) {
    const rel = normalize(decoded.slice("/uploads/".length));
    if (rel.startsWith("..")) return false;
    const filePath = join(UPLOAD_DIR, rel);
    if (!filePath.startsWith(UPLOAD_DIR + "/")) return false;
    return serveFile(res, filePath, { immutable: true }).catch(() => false);
  }

  const studio = decoded === "/studio" || decoded === "/studio/"
    ? "/studio/index.html"
    : decoded.startsWith("/studio/") ? decoded : "";
  const target = studio || decoded;
  const rel = normalize(target === "/" ? "/index.html" : target).replace(/^(\.\.[/\\])+/, "");
  const filePath = join(PUBLIC_DIR, rel);
  if (!filePath.startsWith(PUBLIC_DIR + "/")) return false;
  const isHtml = filePath.endsWith(".html");
  return serveFile(res, filePath, { csp: isHtml, immutable: false }).catch(() => false);
}

async function route(req, res) {
  const url = new URL(req.url, `${SITE_ORIGIN.startsWith("https") ? "https" : "http"}://${req.headers.host || "localhost"}`);

  if (req.method === "OPTIONS") {
    res.writeHead(204, baseHeaders({ allow: "GET, HEAD, POST, OPTIONS" }));
    return res.end();
  }

  if (url.pathname.startsWith("/api/")) {
    const gate = limiter.hit(`api:${clientIp(req)}`, 600, 60_000);
    if (!gate.allowed) return sendJson(res, 429, { error: "请求过于频繁。" });
    if (url.pathname.startsWith("/api/auth/")) {
      const handled = await handleAuth(req, res, url);
      if (handled !== null) return handled;
    }
    if (url.pathname.startsWith("/api/studio/")) {
      const handled = await handleStudioApi(req, res, url);
      if (handled !== false) return handled;
    }
    return sendJson(res, 404, { error: "接口不存在。" });
  }

  if (req.method !== "GET" && req.method !== "HEAD") {
    return sendText(res, 405, "Method Not Allowed", "text/plain; charset=utf-8", { allow: "GET, HEAD, POST" });
  }

  if (await serveStatic(req, res, url)) return undefined;
  if (handlePages(req, res, url) !== false) return undefined;
  return sendHtml(res, 404, renderNotFound({ site: store.data.site }));
}

if (process.env.BLOG_TEST !== "1") {
  await store.init();
  const server = createServer(async (req, res) => {
    try {
      await route(req, res);
    } catch (error) {
      const message = error?.message || "服务器错误";
      if (!res.headersSent) {
        if (req.url?.startsWith("/api/")) sendJson(res, 400, { error: message });
        else sendHtml(res, 500, renderNotFound({ site: store.data.site }));
      } else {
        res.end();
      }
      if (!IS_PRODUCTION) console.error(error);
    }
  });
  server.listen(PORT, HOST, () => {
    console.log(`Blog running at http://localhost:${PORT} (studio: /studio/)`);
    if (!ADMIN_TOTP_SECRET) console.log("提示：未配置 BLOG_ADMIN_TOTP_SECRET，运营台仅依赖口令登录。");
  });
}

export { route, store, normalizeSite };
