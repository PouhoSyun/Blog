// 图片上传：只接受已知图片格式，按魔数校验，落地到 uploads/年/月 目录。
import { mkdir, writeFile, readdir, stat, unlink } from "node:fs/promises";
import { join } from "node:path";
import crypto from "node:crypto";

export const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;

const SIGNATURES = [
  { ext: ".png", mime: "image/png", test: buf => buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  { ext: ".jpg", mime: "image/jpeg", test: buf => buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff },
  { ext: ".gif", mime: "image/gif", test: buf => buf.subarray(0, 6).toString("latin1").startsWith("GIF8") },
  {
    ext: ".webp",
    mime: "image/webp",
    test: buf => buf.subarray(0, 4).toString("latin1") === "RIFF" && buf.subarray(8, 12).toString("latin1") === "WEBP"
  },
  { ext: ".avif", mime: "image/avif", test: buf => buf.subarray(4, 8).toString("latin1") === "ftyp" && buf.subarray(8, 12).toString("latin1").includes("av") }
];

export function detectImage(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 16) return null;
  return SIGNATURES.find(item => {
    try {
      return item.test(buffer);
    } catch {
      return false;
    }
  }) || null;
}

export function decodeDataUrl(value) {
  const match = /^data:([a-z0-9/+.-]+);base64,([A-Za-z0-9+/=\s]+)$/i.exec(String(value ?? ""));
  if (!match) return null;
  const buffer = Buffer.from(match[2].replace(/\s+/g, ""), "base64");
  if (!buffer.length || buffer.length > MAX_UPLOAD_BYTES) return null;
  return { declaredMime: match[1].toLowerCase(), buffer };
}

export async function saveImage(uploadDir, buffer, { prefix = "img" } = {}) {
  const kind = detectImage(buffer);
  if (!kind) throw new Error("只支持 PNG、JPEG、GIF、WebP、AVIF 图片。");
  const now = new Date();
  const folder = `${now.getFullYear()}/${String(now.getMonth() + 1).padStart(2, "0")}`;
  const safePrefix = String(prefix).toLowerCase().replace(/[^a-z0-9-]/g, "").slice(0, 24) || "img";
  const name = `${safePrefix}-${now.toISOString().slice(0, 10)}-${crypto.randomBytes(4).toString("hex")}${kind.ext}`;
  await mkdir(join(uploadDir, folder), { recursive: true });
  await writeFile(join(uploadDir, folder, name), buffer);
  return { url: `/uploads/${folder}/${name}`, bytes: buffer.length, mime: kind.mime };
}

export async function listImages(uploadDir, limit = 200) {
  const out = [];
  async function walk(dir, rel) {
    let entries = [];
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (out.length >= limit * 4) return;
      const next = join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(next, `${rel}/${entry.name}`);
      } else if (detectImageName(entry.name)) {
        const info = await stat(next).catch(() => null);
        if (info) out.push({ url: `${rel}/${entry.name}`, bytes: info.size, at: info.mtime.toISOString() });
      }
    }
  }
  await walk(uploadDir, "/uploads");
  return out.sort((a, b) => b.at.localeCompare(a.at)).slice(0, limit);
}

function detectImageName(name) {
  return /\.(png|jpe?g|gif|webp|avif)$/i.test(name);
}

export async function removeImage(uploadDir, url) {
  const match = /^\/uploads\/((?:\d{4}\/\d{2}\/)?[A-Za-z0-9._-]+)$/.exec(String(url ?? ""));
  if (!match || match[1].includes("..")) throw new Error("非法的图片地址。");
  await unlink(join(uploadDir, match[1]));
}
