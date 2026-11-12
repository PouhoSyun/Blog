import { hashPassword } from '../lib/auth.mjs';

// 不接受命令行口令参数，避免写入 shell 历史或进程列表。
async function secretInput(prompt) {
  if (!process.stdin.isTTY) {
    let input = '';
    for await (const chunk of process.stdin) input += chunk;
    return input.replace(/\r?\n$/, '');
  }
  process.stderr.write(prompt);
  process.stdin.setRawMode(true);
  process.stdin.resume();
  process.stdin.setEncoding('utf8');
  return new Promise((resolve, reject) => {
    let value = '';
    const finish = () => {
      process.stdin.off('data', onData);
      process.stdin.setRawMode(false);
      process.stdin.pause();
      process.stderr.write('\n');
    };
    const onData = chunk => {
      for (const char of chunk) {
        if (char === '\u0003') { finish(); reject(new Error('已取消')); return; }
        if (char === '\r' || char === '\n') { finish(); resolve(value); return; }
        if (char === '\u007f' || char === '\b') value = value.slice(0, -1);
        else if (char >= ' ') value += char;
      }
    };
    process.stdin.on('data', onData);
  });
}
try {
  const password = await secretInput('输入管理员口令（不回显，至少 16 字符）：');
  if (password.length < 16) throw new Error('口令至少需要 16 字符，请使用密码管理器生成随机口令。');
  console.log(`BLOG_ADMIN_PASSWORD_HASH=${hashPassword(password)}`);
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
