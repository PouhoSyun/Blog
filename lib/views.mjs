// 服务端渲染：所有公开页面都是整页 HTML，不依赖前端框架。
import { escapeHtml, renderBlocks } from "./content.mjs";
import { categoryCounts, groupByYear, postDate, postPath, tagCloud } from "./posts.mjs";

const ASSET_VERSION = "lychee-2";

function dateLabel(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return `${date.getFullYear()}.${String(date.getMonth() + 1).padStart(2, "0")}.${String(date.getDate()).padStart(2, "0")}`;
}

function nav(active) {
  const items = [
    ["/", "首页", "home"],
    ["/archive/", "归档", "archive"],
    ["/tags/", "标签", "tags"],
    ["/about/", "关于", "about"]
  ];
  return items
    .map(([href, label, key]) => `<a class="nav-link${active === key ? " is-active" : ""}" href="${href}">${label}</a>`)
    .join("");
}

export function layout({ site, title, description, active, body, canonical = "", bodyClass = "", head = "" }) {
  const pageTitle = title ? `${title} · ${site.title}` : site.title;
  return `<!doctype html>
<html lang="${escapeHtml(site.language || "zh-Hans")}" data-theme="auto">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(pageTitle)}</title>
<meta name="description" content="${escapeHtml(description || site.description)}">
<meta name="color-scheme" content="light dark">
<meta property="og:type" content="website">
<meta property="og:title" content="${escapeHtml(pageTitle)}">
<meta property="og:description" content="${escapeHtml(description || site.description)}">
${canonical ? `<link rel="canonical" href="${escapeHtml(canonical)}">` : ""}
<link rel="icon" href="/assets/lychee.png" type="image/png">
<link rel="alternate" type="application/rss+xml" title="${escapeHtml(site.title)}" href="/feed.xml">
<link rel="stylesheet" href="/styles.css?v=${ASSET_VERSION}">
<style>:root{--accent:${escapeHtml(site.accent || "#A83745")}}</style>
${head}
</head>
<body class="${escapeHtml(bodyClass)}">
<a class="skip-link" href="#main">跳到正文</a>
<div class="page-progress" aria-hidden="true"><span></span></div>
<header class="site-head">
  <div class="shell head-inner">
    <a class="brand" href="/">
      <img class="brand-mark" src="/assets/lychee.png" alt="" width="40" height="40">
      <span class="brand-text">
        <strong>${escapeHtml(site.title)}</strong>
        <small>${escapeHtml(site.subtitle || "")}</small>
      </span>
    </a>
    <nav class="site-nav" aria-label="主导航">${nav(active)}</nav>
    <div class="head-tools">
      <button class="icon-button" type="button" data-search-open aria-label="搜索文章">搜索</button>
      <button class="icon-button" type="button" data-theme-toggle aria-label="切换明暗主题"><span data-theme-label>明</span></button>
      <button class="icon-button menu-button" type="button" data-menu-toggle aria-label="展开菜单">菜单</button>
    </div>
  </div>
  <div class="mobile-nav" data-mobile-nav hidden>${nav(active)}</div>
</header>
<main id="main">${body}</main>
<footer class="site-foot">
  <div class="shell foot-inner">
    <div>
      <p class="foot-title">${escapeHtml(site.title)}</p>
      <p class="foot-note">${escapeHtml(site.footerNote || "")}</p>
    </div>
    <div class="foot-links">
      ${(site.links || []).map(link => `<a href="${escapeHtml(link.href)}"${/^https?:/i.test(link.href) ? ' target="_blank" rel="noopener noreferrer"' : ""}>${escapeHtml(link.label)}</a>`).join("")}
      <a href="/feed.xml">RSS</a>
      <a href="/studio/">运营台</a>
    </div>
  </div>
</footer>
<div class="search-layer" data-search-layer hidden>
  <div class="search-panel" role="dialog" aria-modal="true" aria-label="搜索文章">
    <input type="search" data-search-input placeholder="搜索标题、标签或正文…" autocomplete="off">
    <div class="search-results" data-search-results><p class="search-hint">输入关键词开始搜索。</p></div>
  </div>
</div>
<div class="zoom-layer" data-zoom-layer hidden><img alt=""></div>
<script src="/app.js?v=${ASSET_VERSION}" defer></script>
</body>
</html>`;
}

function postCard(post, { featured = false } = {}) {
  const href = postPath(post);
  return `<article class="post-card${featured ? " is-featured" : ""}">
  ${post.cover ? `<a class="card-cover" href="${href}" tabindex="-1" aria-hidden="true"><img src="${escapeHtml(post.cover)}" alt="" loading="lazy" decoding="async"></a>` : ""}
  <div class="card-body">
    <p class="card-meta">
      <span class="card-cat">${escapeHtml(post.category)}</span>
      <time datetime="${escapeHtml(postDate(post).toISOString())}">${dateLabel(postDate(post))}</time>
      <span>${post.stats?.minutes || 1} 分钟</span>
      ${post.pinned ? '<span class="card-pin">置顶</span>' : ""}
    </p>
    <h2 class="card-title"><a href="${href}">${escapeHtml(post.title)}</a></h2>
    ${post.subtitle ? `<p class="card-sub">${escapeHtml(post.subtitle)}</p>` : ""}
    <p class="card-summary">${escapeHtml(post.summary)}</p>
    <p class="card-tags">${post.tags.map(tag => `<a href="/tags/${encodeURIComponent(tag)}/">#${escapeHtml(tag)}</a>`).join("")}</p>
  </div>
</article>`;
}

export function renderHome({ site, posts, page, totalPages, stats }) {
  const featured = page === 1 ? posts.slice(0, 1) : [];
  const rest = page === 1 ? posts.slice(1) : posts;
  const hero = page === 1
    ? `<section class="hero">
  <div class="shell hero-inner">
    <div class="hero-text">
      <p class="hero-kicker">${escapeHtml(site.author)} · 个人博客</p>
      <h1 class="hero-title">${escapeHtml(site.heroHeading || site.title)}</h1>
      <p class="hero-lines">${escapeHtml((site.heroLines || [])[0] || site.description)}</p>
    </div>
    <div class="hero-art" aria-hidden="true">
      <img src="${escapeHtml(site.heroImage || "/assets/lychee.png")}" alt="">
    </div>
  </div>
</section>`
    : "";
  return layout({
    site,
    active: "home",
    bodyClass: "page-home",
    body: `${hero}
<section class="shell home-grid" id="latest">
  <div class="home-main">
    <h2 class="section-title">${page === 1 ? "近来写的" : `第 ${page} 页`}</h2>
    ${featured.map(post => postCard(post, { featured: true })).join("")}
    <div class="card-list">${rest.map(post => postCard(post)).join("") || (featured.length ? "" : '<p class="empty">还没有已发布的文章。</p>')}</div>
    ${pager("/", page, totalPages)}
  </div>
  <aside class="home-side">
    <section class="side-card profile-card">
      <img class="side-avatar" src="${escapeHtml(site.avatar || "/assets/lychee.png")}" alt="${escapeHtml(site.author)}">
      <p class="side-name">${escapeHtml(site.author)}</p>
      <p class="side-desc">${escapeHtml(site.description)}</p>
      <div class="side-links">${(site.links || []).map(link => `<a href="${escapeHtml(link.href)}"${/^https?:/i.test(link.href) ? ' target="_blank" rel="noopener noreferrer"' : ""}>${escapeHtml(link.label)}</a>`).join("")}</div>
    </section>
    <section class="side-card">
      <h3 class="side-title">分类</h3>
      <ul class="side-list">${stats.categories.map(([name, count]) => `<li><a href="/categories/${encodeURIComponent(name)}/">${escapeHtml(name)}<span>${count}</span></a></li>`).join("") || "<li>暂无</li>"}</ul>
    </section>
    <section class="side-card">
      <h3 class="side-title">标签</h3>
      <p class="tag-cloud">${stats.tagList.slice(0, 24).map(([name, count]) => `<a href="/tags/${encodeURIComponent(name)}/" style="--w:${Math.min(3, count)}">${escapeHtml(name)}</a>`).join("") || "暂无"}</p>
    </section>
  </aside>
</section>`
  });
}

function pager(base, page, totalPages) {
  if (totalPages <= 1) return "";
  const href = n => (n === 1 ? base : `${base}page/${n}/`);
  const items = [];
  for (let n = 1; n <= totalPages; n += 1) {
    items.push(n === page ? `<span class="is-current">${n}</span>` : `<a href="${href(n)}">${n}</a>`);
  }
  return `<nav class="pager" aria-label="分页">
    ${page > 1 ? `<a class="pager-edge" href="${href(page - 1)}">上一页</a>` : ""}
    ${items.join("")}
    ${page < totalPages ? `<a class="pager-edge" href="${href(page + 1)}">下一页</a>` : ""}
  </nav>`;
}

export function renderPostPage({ site, post, prev, next, views }) {
  const rendered = renderBlocks(post.blocks);
  const toc = rendered.toc.length > 1
    ? `<nav class="toc" aria-label="目录"><p class="toc-title">目录</p><ol>${rendered.toc
        .map(item => `<li class="lv-${item.level}"><a href="#${escapeHtml(item.anchor)}">${escapeHtml(item.text)}</a></li>`)
        .join("")}</ol></nav>`
    : "";
  return layout({
    site,
    title: post.title,
    description: post.summary,
    active: "home",
    bodyClass: "page-post",
    head: `<script type="application/ld+json">${JSON.stringify({
      "@context": "https://schema.org",
      "@type": "BlogPosting",
      headline: post.title,
      datePublished: post.publishedAt || post.createdAt,
      dateModified: post.updatedAt,
      author: { "@type": "Person", name: site.author },
      keywords: post.tags.join(",")
    }).replace(/</g, "\\u003c")}</script>`,
    body: `<article class="post">
  <header class="post-head${post.cover ? " has-cover" : ""}"${post.cover ? ` style="--cover:url('${escapeHtml(post.cover)}')"` : ""}>
    <div class="shell post-head-inner">
      <p class="post-kicker"><a href="/categories/${encodeURIComponent(post.category)}/">${escapeHtml(post.category)}</a></p>
      <h1>${escapeHtml(post.title)}</h1>
      ${post.subtitle ? `<p class="post-sub">${escapeHtml(post.subtitle)}</p>` : ""}
      <p class="post-meta">
        <time datetime="${escapeHtml(postDate(post).toISOString())}">${dateLabel(postDate(post))}</time>
        <span>${post.stats?.words || 0} 字</span>
        <span>约 ${post.stats?.minutes || 1} 分钟</span>
        <span>${views} 次阅读</span>
      </p>
    </div>
  </header>
  <div class="shell post-layout">
    <div class="post-body">
      ${rendered.html || '<p class="empty">这篇文章还没有内容。</p>'}
      <footer class="post-foot">
        <p class="post-tags">${post.tags.map(tag => `<a href="/tags/${encodeURIComponent(tag)}/">#${escapeHtml(tag)}</a>`).join("")}</p>
        <p class="post-copy">${escapeHtml(site.footerNote || "")}</p>
      </footer>
      <nav class="post-nav">
        ${prev ? `<a class="post-nav-item" href="${postPath(prev)}"><span>上一篇</span><strong>${escapeHtml(prev.title)}</strong></a>` : "<span></span>"}
        ${next ? `<a class="post-nav-item align-right" href="${postPath(next)}"><span>下一篇</span><strong>${escapeHtml(next.title)}</strong></a>` : "<span></span>"}
      </nav>
    </div>
    <aside class="post-side">${toc}</aside>
  </div>
</article>`
  });
}

export function renderArchive({ site, posts }) {
  const groups = groupByYear(posts);
  return layout({
    site,
    title: "归档",
    active: "archive",
    bodyClass: "page-archive",
    body: `<section class="shell narrow">
  <h1 class="page-title">归档</h1>
  <p class="page-lead">共 ${posts.length} 篇文章，按时间倒序排列。</p>
  ${groups
    .map(([year, items]) => `<section class="timeline-year">
    <h2>${year}<span>${items.length} 篇</span></h2>
    <ul class="timeline">${items
      .map(post => `<li><time>${dateLabel(postDate(post))}</time><a href="${postPath(post)}">${escapeHtml(post.title)}</a><em>${escapeHtml(post.category)}</em></li>`)
      .join("")}</ul>
  </section>`)
    .join("") || '<p class="empty">暂无文章。</p>'}
</section>`
  });
}

export function renderTagIndex({ site, posts }) {
  const tags = tagCloud(posts);
  const cats = categoryCounts(posts);
  return layout({
    site,
    title: "标签",
    active: "tags",
    bodyClass: "page-tags",
    body: `<section class="shell narrow">
  <h1 class="page-title">标签与分类</h1>
  <h2 class="section-title">分类</h2>
  <p class="tag-cloud big">${cats.map(([name, count]) => `<a href="/categories/${encodeURIComponent(name)}/" style="--w:${Math.min(3, count)}">${escapeHtml(name)}<span>${count}</span></a>`).join("") || "暂无"}</p>
  <h2 class="section-title">标签</h2>
  <p class="tag-cloud big">${tags.map(([name, count]) => `<a href="/tags/${encodeURIComponent(name)}/" style="--w:${Math.min(3, count)}">${escapeHtml(name)}<span>${count}</span></a>`).join("") || "暂无"}</p>
</section>`
  });
}

export function renderList({ site, heading, lead, posts, base, page, totalPages }) {
  return layout({
    site,
    title: heading,
    active: "tags",
    bodyClass: "page-list",
    body: `<section class="shell narrow">
  <h1 class="page-title">${escapeHtml(heading)}</h1>
  <p class="page-lead">${escapeHtml(lead)}</p>
  <div class="card-list">${posts.map(post => postCard(post)).join("") || '<p class="empty">暂无文章。</p>'}</div>
  ${pager(base, page, totalPages)}
</section>`
  });
}

export function renderAbout({ site }) {
  const rendered = renderBlocks(site.aboutBlocks || []);
  return layout({
    site,
    title: "关于",
    active: "about",
    bodyClass: "page-about",
    body: `<section class="shell narrow about">
  <div class="about-head">
    <img src="${escapeHtml(site.avatar || "/assets/lychee.png")}" alt="${escapeHtml(site.author)}">
    <div>
      <h1 class="page-title">${escapeHtml(site.author)}</h1>
      <p class="page-lead">${escapeHtml(site.description)}</p>
      <div class="side-links">${(site.links || []).map(link => `<a href="${escapeHtml(link.href)}"${/^https?:/i.test(link.href) ? ' target="_blank" rel="noopener noreferrer"' : ""}>${escapeHtml(link.label)}</a>`).join("")}</div>
    </div>
  </div>
  <div class="post-body">${rendered.html}</div>
</section>`
  });
}

export function renderNotFound({ site }) {
  return layout({
    site,
    title: "页面不存在",
    active: "",
    bodyClass: "page-404",
    body: `<section class="shell narrow center">
  <h1 class="big-404">404</h1>
  <p class="page-lead">这条路没有通向任何文章。</p>
  <p><a class="button primary" href="/">回到首页</a></p>
</section>`
  });
}

export function renderFeed({ site, posts, origin }) {
  const items = posts.slice(0, 20).map(post => {
    const rendered = renderBlocks(post.blocks);
    return `<item>
  <title>${escapeHtml(post.title)}</title>
  <link>${escapeHtml(origin + postPath(post))}</link>
  <guid isPermaLink="false">${escapeHtml(post.id)}</guid>
  <pubDate>${postDate(post).toUTCString()}</pubDate>
  <description>${escapeHtml(post.summary)}</description>
  <content:encoded><![CDATA[${rendered.html.replace(/]]>/g, "]]&gt;")}]]></content:encoded>
</item>`;
  });
  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/">
<channel>
<title>${escapeHtml(site.title)}</title>
<link>${escapeHtml(origin)}/</link>
<description>${escapeHtml(site.description)}</description>
<language>${escapeHtml(site.language || "zh-Hans")}</language>
<lastBuildDate>${new Date().toUTCString()}</lastBuildDate>
${items.join("\n")}
</channel>
</rss>`;
}

export function renderSitemap({ posts, origin }) {
  const urls = ["/", "/archive/", "/tags/", "/about/"].map(path => `<url><loc>${escapeHtml(origin + path)}</loc></url>`);
  for (const post of posts) {
    urls.push(`<url><loc>${escapeHtml(origin + postPath(post))}</loc><lastmod>${new Date(post.updatedAt).toISOString().slice(0, 10)}</lastmod></url>`);
  }
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls.join("")}</urlset>`;
}
