import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { sanitizeInline } from '../lib/content.mjs';
import { renderPostPage } from '../lib/views.mjs';
import { defaultData } from '../lib/store.mjs';
import { normalizePost } from '../lib/posts.mjs';
test('HTML injection is escaped', () => {
 assert.ok(!sanitizeInline('<img src=x onerror=alert(1)>').includes('<img'));
 assert.ok(!sanitizeInline('<a href="javascript:alert(1)">x</a>').includes('href'));
 const post=normalizePost({title:'</script><script>alert(1)</script>',status:'published'});
 assert.ok(!renderPostPage({site:defaultData.site,post,views:0}).includes('</script><script>alert'));
});
test('authentication, publication, persistence and CSRF', async () => {
 const dir=await mkdtemp(join(tmpdir(),'blog-test-'));
 const port=19481, base=`http://127.0.0.1:${port}`;
 let child;
 const start=async()=>{
 child=spawn(process.execPath,['server.mjs'],{env:{...process.env,PORT:String(port),HOST:'127.0.0.1',BLOG_DATA_FILE:join(dir,'blog.json'),BLOG_UPLOAD_DIR:join(dir,'uploads'),BLOG_ADMIN_USER:'admin',BLOG_ADMIN_PASSWORD_HASH:'',BLOG_ADMIN_TOTP_SECRET:'',BLOG_COOKIE_SECURE:'0',BLOG_TRUST_PROXY:'0',BLOG_ALLOWED_ORIGINS:'',BLOG_TEST:'0',BLOG_ADMIN_PASSWORD:'test-secret-9284',BLOG_SITE_ORIGIN:base,NODE_ENV:'development'},stdio:'ignore'});
 for(let i=0;i<80;i++){try{if((await fetch(base+'/api/auth/session')).ok)return;}catch{} await new Promise(r=>setTimeout(r,50));}throw Error('startup failed');
 };
 const stop=async()=>{if(child&&!child.killed){child.kill();await new Promise(r=>child.once('exit',r));}};
 try {
 await start();
 assert.equal((await fetch(base+'/')).status,200);
 assert.equal((await fetch(base+'/api/studio/bootstrap')).status,401);
 const login=await fetch(base+'/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({user:'admin',password:'test-secret-9284'})});
 assert.equal(login.status,200);
 const cookie=login.headers.getSetCookie().map(x=>x.split(';')[0]).join('; '), session=await login.json();
 const headers={'Content-Type':'application/json',cookie,'x-csrf-token':session.csrf};
 assert.equal((await fetch(base+'/api/studio/posts',{method:'POST',headers:{cookie},body:'{}'})).status,403);
 let r=await fetch(base+'/api/studio/posts',{method:'POST',headers,body:JSON.stringify({title:'测试图文',slug:'test-post',status:'draft',blocks:[{type:'paragraph',html:'正文 <strong>加粗</strong>'}]})});
 const {post}=await r.json();assert.ok(post.id);
 assert.equal((await (await fetch(base+'/search.json')).json()).posts.length,0);
 r=await fetch(base+'/api/studio/posts/status',{method:'POST',headers,body:JSON.stringify({id:post.id,status:'published'})});assert.equal(r.status,200);
 const result=await r.json();assert.equal((await fetch(base+result.post.url)).status,200);
 assert.equal((await (await fetch(base+'/search.json')).json()).posts.length,1);
 assert.equal((await fetch(base+'/api/studio/posts/status',{method:'POST',headers:{...headers,origin:'https://evil.example'},body:'{}'})).status,403);
 await stop();await start();
 assert.equal((await (await fetch(base+'/search.json')).json()).posts.length,1);
 } finally {await stop();await rm(dir,{recursive:true,force:true});}
});

test('visual migration preserves custom settings and articles', async () => {
 const {normalizeData}=await import('../lib/store.mjs');
 const old=normalizeData({site:{title:'溯光 · PouhoSyun',heroImage:'/assets/hero.svg',accent:'#2f6f6b'},posts:[{id:'keep'}]});
 assert.equal(old.site.title,'荔枝新园'); assert.equal(old.site.heroImage,'/assets/lychee.png'); assert.equal(old.posts[0].id,'keep');
 const custom=normalizeData({site:{title:'自定义名称',heroImage:'/uploads/custom.png',accent:'#123456'}});
 assert.equal(custom.site.title,'自定义名称'); assert.equal(custom.site.heroImage,'/uploads/custom.png'); assert.equal(custom.site.accent,'#123456');
 assert.deepEqual(normalizeData(old),old);
});
