// 后台登录相关：口令校验、可选 TOTP 二次验证、会话、速率限制、CSRF。
import crypto from "node:crypto";

export const SESSION_TTL_MS = 12 * 60 * 60 * 1000;
export const CHALLENGE_TTL_MS = 5 * 60 * 1000;

export function randomToken(bytes = 32) {
  return crypto.randomBytes(bytes).toString("hex");
}

export function hashPassword(password, salt = crypto.randomBytes(16).toString("hex")) {
  const hash = crypto.scryptSync(String(password), salt, 64).toString("hex");
  return `scrypt:${salt}:${hash}`;
}

export function verifyPassword(password, stored = "") {
  const parts = String(stored).split(":");
  if (parts.length !== 3 || parts[0] !== "scrypt") return false;
  const [, salt, expected] = parts;
  const actual = crypto.scryptSync(String(password), salt, 64);
  const expectedBuffer = Buffer.from(expected, "hex");
  return expectedBuffer.length === actual.length && crypto.timingSafeEqual(expectedBuffer, actual);
}

export function constantTimeEqual(a, b) {
  const left = Buffer.from(String(a));
  const right = Buffer.from(String(b));
  if (left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
}

function base32Decode(input) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const clean = String(input).toUpperCase().replace(/[^A-Z2-7]/g, "");
  let bits = 0;
  let value = 0;
  const out = [];
  for (const char of clean) {
    const index = alphabet.indexOf(char);
    if (index === -1) continue;
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      out.push((value >>> bits) & 0xff);
    }
  }
  return Buffer.from(out);
}

export function base32Encode(buffer) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of buffer) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      out += alphabet[(value >>> bits) & 31];
    }
  }
  if (bits > 0) out += alphabet[(value << (5 - bits)) & 31];
  return out;
}

function hotp(secret, counter) {
  const buffer = Buffer.alloc(8);
  buffer.writeBigUInt64BE(BigInt(counter));
  const digest = crypto.createHmac("sha1", secret).update(buffer).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  const code = ((digest[offset] & 0x7f) << 24) | (digest[offset + 1] << 16) | (digest[offset + 2] << 8) | digest[offset + 3];
  return String(code % 1_000_000).padStart(6, "0");
}

// 允许前后各一个 30 秒窗口，容忍设备时间偏差。
export function verifyTotp(secretBase32, token, window = 1) {
  const code = String(token ?? "").replace(/\D/g, "");
  if (code.length !== 6) return false;
  const secret = base32Decode(secretBase32);
  if (!secret.length) return false;
  const counter = Math.floor(Date.now() / 30000);
  for (let drift = -window; drift <= window; drift += 1) {
    if (constantTimeEqual(hotp(secret, counter + drift), code)) return true;
  }
  return false;
}

export function createRateLimiter() {
  const buckets = new Map();
  return {
    hit(key, limit, windowMs) {
      const now = Date.now();
      const fresh = (buckets.get(key) || []).filter(time => now - time < windowMs);
      fresh.push(now);
      buckets.set(key, fresh);
      if (buckets.size > 5000) {
        for (const [existing, times] of buckets) {
          if (!times.some(time => now - time < windowMs)) buckets.delete(existing);
        }
      }
      return { allowed: fresh.length <= limit, retryAfterMs: Math.max(0, windowMs - (now - fresh[0])) };
    },
    reset(key) {
      buckets.delete(key);
    }
  };
}

export function parseCookies(header = "") {
  const out = {};
  for (const part of String(header).split(";")) {
    const index = part.indexOf("=");
    if (index === -1) continue;
    const name = part.slice(0, index).trim();
    if (!name) continue;
    out[name] = decodeURIComponent(part.slice(index + 1).trim());
  }
  return out;
}

export function serializeCookie(name, value, options = {}) {
  const parts = [`${name}=${encodeURIComponent(value)}`];
  if (options.maxAge !== undefined) parts.push(`Max-Age=${Math.floor(options.maxAge)}`);
  parts.push(`Path=${options.path || "/"}`);
  if (options.httpOnly !== false) parts.push("HttpOnly");
  if (options.secure) parts.push("Secure");
  parts.push(`SameSite=${options.sameSite || "Strict"}`);
  return parts.join("; ");
}

export function pruneSessions(data) {
  const now = Date.now();
  data.adminSessions = data.adminSessions.filter(session => new Date(session.expiresAt).getTime() > now);
  data.loginChallenges = data.loginChallenges.filter(item => new Date(item.expiresAt).getTime() > now);
}

export function findSession(data, token) {
  if (!token) return null;
  pruneSessions(data);
  return data.adminSessions.find(session => constantTimeEqual(session.token, token)) || null;
}
