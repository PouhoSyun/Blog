// JSON 文件持久化：单文件数据库 + 原子写入 + 串行写队列。
import { readFile, writeFile, mkdir, rename, stat } from "node:fs/promises";
import { dirname } from "node:path";
import crypto from "node:crypto";

export const defaultData = {
  version: 1,
  site: {
    title: "荔枝新园",
    subtitle: "随笔、照片和一些笔记",
    description: "PouhoSyun 的个人博客：随笔、影像与技术记录。",
    author: "PouhoSyun",
    language: "zh-Hans",
    heroHeading: "荔枝新园",
    heroLines: ["随笔、照片和一些笔记。"] ,
    heroImage: "/assets/lychee.png",
    avatar: "/assets/lychee.png",
    accent: "#A83745",
    footerNote: "内容版权归作者所有，转载请注明出处。",
    links: [
      { label: "GitHub", href: "https://github.com/PouhoSyun" }
    ],
    aboutBlocks: [
      { id: "a1", type: "heading", level: 2, text: "关于我" },
      { id: "a2", type: "paragraph", html: "这里是 PouhoSyun 的自留地。写一些长文、放一些照片，偶尔记录工程笔记。" },
      { id: "a3", type: "heading", level: 3, text: "关于这个站点" },
      { id: "a4", type: "paragraph", html: "自建 Node.js 服务，服务端渲染，自带图文排版后台，部署在个人服务器上。" }
    ]
  },
  posts: [],
  pageViews: {},
  adminSessions: [],
  loginChallenges: [],
  auditLog: []
};

function cloneDefaults() {
  return JSON.parse(JSON.stringify(defaultData));
}

export function normalizeData(input) {
  const data = { ...cloneDefaults(), ...(input && typeof input === "object" ? input : {}) };
  data.site = { ...cloneDefaults().site, ...(data.site || {}) };
  // 仅迁移旧模板默认值；保留作者已经设置的图片、文案与配色。
  if (!data.site.visualRevision) {
    const legacy = { title: "溯光 · PouhoSyun", subtitle: "把日子写成可以回头的样子", heroHeading: "溯光", heroImage: "/assets/hero.svg", avatar: "/assets/avatar.svg", accent: "#2f6f6b" };
    for (const [key, value] of Object.entries(legacy)) {
      if (data.site[key] === value) data.site[key] = defaultData.site[key];
    }
    if (JSON.stringify(data.site.heroLines) === JSON.stringify(["在噪声里留一条安静的航道", "记录光、记录路、记录人"])) data.site.heroLines = [...defaultData.site.heroLines];
    if (Array.isArray(data.site.links)) data.site.links = data.site.links.filter(link => link.href !== "mailto:hello@example.com");
    data.site.visualRevision = 2;
  }
  data.site.links = Array.isArray(data.site.links) ? data.site.links : [];
  data.site.heroLines = Array.isArray(data.site.heroLines) ? data.site.heroLines : [];
  data.site.aboutBlocks = Array.isArray(data.site.aboutBlocks) ? data.site.aboutBlocks : [];
  data.posts = Array.isArray(data.posts) ? data.posts : [];
  data.pageViews = data.pageViews && typeof data.pageViews === "object" ? data.pageViews : {};
  data.adminSessions = Array.isArray(data.adminSessions) ? data.adminSessions : [];
  data.loginChallenges = Array.isArray(data.loginChallenges) ? data.loginChallenges : [];
  data.auditLog = Array.isArray(data.auditLog) ? data.auditLog : [];
  return data;
}

export class Store {
  constructor(file) {
    this.file = file;
    this.data = cloneDefaults();
    this.queue = Promise.resolve();
  }

  async init() {
    await mkdir(dirname(this.file), { recursive: true });
    try {
      await stat(this.file);
      this.data = normalizeData(JSON.parse(await readFile(this.file, "utf8")));
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      this.data = cloneDefaults();
      await this.flush();
    }
    return this.data;
  }

  async flush() {
    const tmp = `${this.file}.${process.pid}.${Date.now()}.tmp`;
    await mkdir(dirname(this.file), { recursive: true });
    await writeFile(tmp, JSON.stringify(this.data, null, 2), "utf8");
    await rename(tmp, this.file);
  }

  // 所有写操作串行执行，避免并发请求互相覆盖。
  update(mutator) {
    const run = this.queue.then(async () => {
      const previous = structuredClone(this.data);
      try {
        const result = await mutator(this.data);
        await this.flush();
        return result;
      } catch (error) { this.data = previous; throw error; }
    });
    this.queue = run.catch(() => {});
    return run;
  }

  log(action, detail = "") {
    this.data.auditLog.unshift({ id: crypto.randomUUID(), action, detail: String(detail).slice(0, 300), at: new Date().toISOString() });
    this.data.auditLog = this.data.auditLog.slice(0, 500);
  }
}
