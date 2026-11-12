// 内容模型：块（block）规范化、行内 HTML 白名单清洗、渲染为 HTML。
// 服务器是唯一的信任边界：编辑器提交的所有内容都会在这里重新清洗。
import crypto from "node:crypto";

export const BLOCK_TYPES = ["paragraph", "heading", "image", "media", "gallery", "quote", "list", "callout", "code", "divider"];
const IMAGE_LAYOUTS = ["normal", "wide", "full", "left", "right"];
const CALLOUT_TONES = ["info", "tip", "warn"];

export function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function decodeEntities(value) {
  return String(value ?? "").replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, code) => {
    const lower = code.toLowerCase();
    if (lower === "amp") return "&";
    if (lower === "lt") return "<";
    if (lower === "gt") return ">";
    if (lower === "quot") return '"';
    if (lower === "apos") return "'";
    if (lower === "nbsp") return "\u00a0";
    if (lower.startsWith("#x")) return safeCodePoint(parseInt(lower.slice(2), 16), whole);
    if (lower.startsWith("#")) return safeCodePoint(parseInt(lower.slice(1), 10), whole);
    return whole;
  });
}

function safeCodePoint(num, fallback) {
  if (!Number.isFinite(num) || num <= 0 || num > 0x10ffff) return fallback;
  try {
    return String.fromCodePoint(num);
  } catch {
    return fallback;
  }
}

export function cleanText(value, max = 500) {
  return String(value ?? "").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "").trim().slice(0, max);
}

// 链接只允许 http(s)、mailto、站内相对路径与锚点。
export function safeHref(value) {
  const href = cleanText(decodeEntities(value), 2000).replace(/[\s\u0000-\u001f]/g, "");
  if (!href) return "";
  if (/^(https?:\/\/|mailto:)/i.test(href)) return href;
  if (/^\/(?!\/)/.test(href) || href.startsWith("#")) return href;
  return "";
}

// 图片只允许本站上传目录或 https 外链。
export function safeImageSrc(value) {
  const src = cleanText(value, 2000);
  if (/^\/uploads\/[A-Za-z0-9._\-/]+$/.test(src) && !src.includes("..")) return src;
  if (/^\/assets\/[A-Za-z0-9._\-/]+$/.test(src) && !src.includes("..")) return src;
  if (/^https:\/\/[^\s"'<>]+$/i.test(src)) return src;
  return "";
}

const INLINE_MAP = {
  b: "strong",
  strong: "strong",
  i: "em",
  em: "em",
  u: "u",
  s: "s",
  del: "s",
  strike: "s",
  code: "code",
  mark: "mark",
  sub: "sub",
  sup: "sup",
  a: "a"
};

// 行内白名单：strong/em/u/s/code/mark/sub/sup/a[href]/br，其他标签全部丢弃，文本全部重新转义。
export function sanitizeInline(input, max = 40000) {
  const src = String(input ?? "").slice(0, max);
  const tagRe = /<(\/?)([a-zA-Z][a-zA-Z0-9]*)\b([^<>]*)>/g;
  const stack = [];
  let out = "";
  let last = 0;
  let match;
  const pushText = text => {
    if (text) out += escapeHtml(decodeEntities(text));
  };
  while ((match = tagRe.exec(src))) {
    pushText(src.slice(last, match.index));
    last = tagRe.lastIndex;
    const closing = match[1] === "/";
    const name = match[2].toLowerCase();
    const attrs = match[3] || "";
    if (name === "br") {
      out += "<br>";
      continue;
    }
    if ((name === "div" || name === "p") && closing) {
      out += "<br>";
      continue;
    }
    const mapped = INLINE_MAP[name];
    if (!mapped) continue;
    if (closing) {
      const index = stack.map(item => item.tag).lastIndexOf(mapped);
      if (index === -1) continue;
      while (stack.length > index) {
        const item = stack.pop();
        if (item.emitted) out += `</${item.tag}>`;
      }
      continue;
    }
    if (stack.length > 20) continue;
    if (mapped === "a") {
      const hrefMatch = attrs.match(/href\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/i);
      const href = safeHref(hrefMatch ? hrefMatch[2] ?? hrefMatch[3] ?? hrefMatch[4] : "");
      if (!href || stack.some(item => item.tag === "a")) {
        stack.push({ tag: "a", emitted: false });
        continue;
      }
      const external = /^https?:\/\//i.test(href);
      out += `<a href="${escapeHtml(href)}"${external ? ' target="_blank" rel="noopener noreferrer"' : ""}>`;
      stack.push({ tag: "a", emitted: true });
      continue;
    }
    out += `<${mapped}>`;
    stack.push({ tag: mapped, emitted: true });
  }
  pushText(src.slice(last));
  while (stack.length) {
    const item = stack.pop();
    if (item.emitted) out += `</${item.tag}>`;
  }
  return out.replace(/(<br>\s*)+$/, "").replace(/^\s*(<br>\s*)+/, "").trim();
}

export function inlineToText(html) {
  return decodeEntities(String(html ?? "").replace(/<br\s*\/?>/gi, "\n").replace(/<[^>]+>/g, "")).trim();
}

function blockId(value) {
  const id = String(value ?? "");
  return /^[A-Za-z0-9_-]{1,40}$/.test(id) ? id : `b${crypto.randomBytes(5).toString("hex")}`;
}

function pick(value, allowed, fallback) {
  return allowed.includes(value) ? value : fallback;
}

export function normalizeBlock(raw) {
  if (!raw || typeof raw !== "object") return null;
  const type = pick(raw.type, BLOCK_TYPES, null);
  if (!type) return null;
  const id = blockId(raw.id);
  switch (type) {
    case "paragraph":
      return { id, type, html: sanitizeInline(raw.html) };
    case "heading":
      return { id, type, level: pick(Number(raw.level), [2, 3, 4], 2), text: cleanText(inlineToText(raw.text), 200) };
    case "image": {
      const src = safeImageSrc(raw.src);
      return {
        id,
        type,
        src,
        alt: cleanText(raw.alt, 200),
        caption: sanitizeInline(raw.caption, 2000),
        layout: pick(raw.layout, IMAGE_LAYOUTS, "normal")
      };
    }
    case "media":
      return {
        id,
        type,
        src: safeImageSrc(raw.src),
        alt: cleanText(raw.alt, 200),
        html: sanitizeInline(raw.html),
        side: pick(raw.side, ["left", "right"], "left")
      };
    case "gallery": {
      const images = (Array.isArray(raw.images) ? raw.images : [])
        .slice(0, 40)
        .map(item => ({ src: safeImageSrc(item?.src), caption: cleanText(item?.caption, 200) }))
        .filter(item => item.src);
      return { id, type, images, columns: pick(Number(raw.columns), [2, 3, 4], 3), caption: sanitizeInline(raw.caption, 2000) };
    }
    case "quote":
      return { id, type, html: sanitizeInline(raw.html), cite: cleanText(raw.cite, 200) };
    case "list": {
      const items = (Array.isArray(raw.items) ? raw.items : [])
        .slice(0, 200)
        .map(item => sanitizeInline(item, 4000))
        .filter(Boolean);
      return { id, type, ordered: raw.ordered === true, items };
    }
    case "callout":
      return { id, type, tone: pick(raw.tone, CALLOUT_TONES, "info"), html: sanitizeInline(raw.html) };
    case "code":
      return { id, type, lang: cleanText(raw.lang, 30).replace(/[^\w+#.-]/g, ""), text: String(raw.text ?? "").slice(0, 60000) };
    case "divider":
      return { id, type };
    default:
      return null;
  }
}

export function normalizeBlocks(blocks) {
  return (Array.isArray(blocks) ? blocks : [])
    .slice(0, 800)
    .map(normalizeBlock)
    .filter(Boolean);
}

function slugifyHeading(text, used) {
  let base = String(text)
    .toLowerCase()
    .replace(/[^\p{Letter}\p{Number}]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48) || "section";
  let slug = base;
  let n = 2;
  while (used.has(slug)) slug = `${base}-${n++}`;
  used.add(slug);
  return slug;
}

function img(src, alt, extra = "") {
  return `<img src="${escapeHtml(src)}" alt="${escapeHtml(alt || "")}" loading="lazy" decoding="async" data-zoom${extra}>`;
}

// 渲染块为文章 HTML，同时返回目录与纯文本（用于摘要、搜索、字数统计）。
export function renderBlocks(blocks) {
  const toc = [];
  const text = [];
  const used = new Set();
  const html = normalizeBlocks(blocks).map(block => {
    switch (block.type) {
      case "paragraph":
        if (!block.html) return "";
        text.push(inlineToText(block.html));
        return `<p>${block.html}</p>`;
      case "heading": {
        if (!block.text) return "";
        const anchor = slugifyHeading(block.text, used);
        toc.push({ level: block.level, text: block.text, anchor });
        text.push(block.text);
        return `<h${block.level} id="${escapeHtml(anchor)}">${escapeHtml(block.text)}</h${block.level}>`;
      }
      case "image":
        if (!block.src) return "";
        text.push(inlineToText(block.caption));
        return `<figure class="b-image layout-${block.layout}">${img(block.src, block.alt || inlineToText(block.caption))}${block.caption ? `<figcaption>${block.caption}</figcaption>` : ""}</figure>`;
      case "media":
        text.push(inlineToText(block.html));
        return `<div class="b-media side-${block.side}">${block.src ? `<figure>${img(block.src, block.alt)}</figure>` : ""}<div class="b-media-text"><p>${block.html.replace(/(<br>){2,}/g, "</p><p>")}</p></div></div>`;
      case "gallery":
        if (!block.images.length) return "";
        text.push(inlineToText(block.caption));
        return `<figure class="b-gallery cols-${block.columns}"><div class="b-gallery-grid">${block.images
          .map(item => `<figure>${img(item.src, item.caption)}${item.caption ? `<figcaption>${escapeHtml(item.caption)}</figcaption>` : ""}</figure>`)
          .join("")}</div>${block.caption ? `<figcaption class="b-gallery-caption">${block.caption}</figcaption>` : ""}</figure>`;
      case "quote":
        if (!block.html) return "";
        text.push(inlineToText(block.html));
        return `<blockquote class="b-quote"><p>${block.html}</p>${block.cite ? `<cite>${escapeHtml(block.cite)}</cite>` : ""}</blockquote>`;
      case "list": {
        if (!block.items.length) return "";
        const tag = block.ordered ? "ol" : "ul";
        block.items.forEach(item => text.push(inlineToText(item)));
        return `<${tag}>${block.items.map(item => `<li>${item}</li>`).join("")}</${tag}>`;
      }
      case "callout":
        if (!block.html) return "";
        text.push(inlineToText(block.html));
        return `<aside class="b-callout tone-${block.tone}"><p>${block.html}</p></aside>`;
      case "code":
        if (!block.text) return "";
        return `<pre class="b-code"${block.lang ? ` data-lang="${escapeHtml(block.lang)}"` : ""}><code>${escapeHtml(block.text)}</code></pre>`;
      case "divider":
        return `<hr class="b-divider">`;
      default:
        return "";
    }
  }).filter(Boolean).join("\n");
  return { html, toc, text: text.filter(Boolean).join("\n") };
}

export function countWords(text) {
  const str = String(text ?? "");
  const cjk = (str.match(/[\u3400-\u9fff\uf900-\ufaff]/g) || []).length;
  const latin = (str.replace(/[\u3400-\u9fff\uf900-\ufaff]/g, " ").match(/[A-Za-z0-9\u00c0-\u024f]+/g) || []).length;
  return cjk + latin;
}

export function readingMinutes(text) {
  const str = String(text ?? "");
  const cjk = (str.match(/[\u3400-\u9fff\uf900-\ufaff]/g) || []).length;
  const latin = countWords(str) - cjk;
  return Math.max(1, Math.round(cjk / 400 + latin / 220));
}

export function makeExcerpt(text, max = 120) {
  const clean = String(text ?? "").replace(/\s+/g, " ").trim();
  return clean.length > max ? `${clean.slice(0, max)}…` : clean;
}

export function slugify(value) {
  return String(value ?? "")
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

export function isValidSlug(value) {
  return /^[a-z0-9][a-z0-9-]{0,79}$/.test(String(value ?? ""));
}
