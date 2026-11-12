// 文章模型：规范化、查询、归档与标签聚合。
import crypto from "node:crypto";
import {
  cleanText,
  countWords,
  inlineToText,
  isValidSlug,
  makeExcerpt,
  normalizeBlocks,
  readingMinutes,
  renderBlocks,
  safeImageSrc,
  slugify
} from "./content.mjs";

export const CATEGORIES = ["随笔", "影像", "技术", "读书", "课程"];

export function normalizePost(input, existing = {}) {
  const now = new Date().toISOString();
  const title = cleanText(input.title, 160) || existing.title || "未命名草稿";
  const blocks = normalizeBlocks(input.blocks ?? existing.blocks ?? []);
  const rendered = renderBlocks(blocks);
  const tags = Array.from(
    new Set(
      (Array.isArray(input.tags) ? input.tags : String(input.tags ?? "").split(/[,，\s]+/))
        .map(tag => cleanText(tag, 24))
        .filter(Boolean)
    )
  ).slice(0, 8);
  const slugSource = cleanText(input.slug, 80) || existing.slug || slugify(title) || `post-${crypto.randomBytes(3).toString("hex")}`;
  const slug = isValidSlug(slugSource) ? slugSource : `post-${crypto.randomBytes(4).toString("hex")}`;
  const status = input.status === "published" ? "published" : "draft";
  const publishedAt = status === "published"
    ? cleanText(input.publishedAt, 40) || existing.publishedAt || now
    : existing.publishedAt || "";
  if (publishedAt && !Number.isFinite(Date.parse(publishedAt))) throw new Error("发布日期无效。");
  return {
    id: existing.id || crypto.randomUUID(),
    slug,
    title,
    subtitle: cleanText(input.subtitle, 240),
    category: CATEGORIES.includes(input.category) ? input.category : existing.category || "随笔",
    tags,
    cover: safeImageSrc(input.cover) || "",
    coverAlt: cleanText(input.coverAlt, 160),
    summary: cleanText(input.summary, 400) || makeExcerpt(rendered.text, 140),
    blocks,
    status,
    pinned: input.pinned === true,
    allowComments: input.allowComments !== false,
    createdAt: existing.createdAt || now,
    updatedAt: now,
    publishedAt,
    stats: {
      words: countWords(rendered.text),
      minutes: readingMinutes(rendered.text),
      images: blocks.reduce((total, block) => {
        if (block.type === "image" || block.type === "media") return total + (block.src ? 1 : 0);
        if (block.type === "gallery") return total + block.images.length;
        return total;
      }, 0)
    }
  };
}

export function postDate(post) {
  return new Date(post.publishedAt || post.updatedAt || post.createdAt || Date.now());
}

export function publishedPosts(data) {
  return data.posts
    .filter(post => post.status === "published")
    .sort((a, b) => {
      if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
      return postDate(b) - postDate(a);
    });
}

export function postByPath(data, slug, { includeDrafts = false } = {}) {
  return data.posts.find(post => post.slug === slug && (includeDrafts || post.status === "published")) || null;
}

export function renderPost(post) {
  return renderBlocks(post.blocks);
}

export function postPath(post) {
  const date = postDate(post);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  return `/posts/${year}/${month}/${post.slug}/`;
}

export function groupByYear(posts) {
  const map = new Map();
  for (const post of posts) {
    const year = postDate(post).getFullYear();
    if (!map.has(year)) map.set(year, []);
    map.get(year).push(post);
  }
  return Array.from(map.entries()).sort((a, b) => b[0] - a[0]);
}

export function tagCloud(posts) {
  const map = new Map();
  for (const post of posts) {
    for (const tag of post.tags) map.set(tag, (map.get(tag) || 0) + 1);
  }
  return Array.from(map.entries()).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "zh-Hans"));
}

export function categoryCounts(posts) {
  const map = new Map();
  for (const post of posts) map.set(post.category, (map.get(post.category) || 0) + 1);
  return Array.from(map.entries()).sort((a, b) => b[1] - a[1]);
}

export function searchIndex(posts) {
  return posts.map(post => ({
    title: post.title,
    url: postPath(post),
    category: post.category,
    tags: post.tags,
    date: postDate(post).toISOString().slice(0, 10),
    text: `${post.summary} ${post.blocks
      .map(block => {
        if (block.type === "paragraph" || block.type === "quote" || block.type === "callout") return inlineToText(block.html);
        if (block.type === "heading") return block.text;
        if (block.type === "list") return block.items.map(inlineToText).join(" ");
        return "";
      })
      .join(" ")}`.replace(/\s+/g, " ").trim().slice(0, 4000)
  }));
}
