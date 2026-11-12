import crypto from 'node:crypto';
import { base32Encode } from '../lib/auth.mjs';
const secret = base32Encode(crypto.randomBytes(20));
const issuer = 'PouhoSyun Blog';
console.log('请离线保存以下密钥，并手动添加到验证器（SHA1 / 6位 / 30秒）。');
console.log('不要将密钥或 URI 分享、提交到 Git 或上传在线二维码网站。');
console.log(`BLOG_ADMIN_TOTP_SECRET=${secret}`);
console.log(`otpauth://totp/${encodeURIComponent(issuer + ':admin')}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`);
console.log('写入 .env 后重启服务生效。丢失验证器时需通过可信服务器终端替换密钥；无网页找回。');
