(() => {
  'use strict';
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const html = document.documentElement;
  const media = window.matchMedia('(prefers-color-scheme: dark)');
  let savedTheme = '';
  try { savedTheme = localStorage.getItem('blog-theme') || ''; } catch {}
  const applyTheme = theme => {
    html.dataset.theme = theme;
    const label = $('[data-theme-label]');
    if (label) label.textContent = theme === 'dark' ? '暗' : '明';
    $('[data-theme-toggle]')?.setAttribute('aria-label', theme === 'dark' ? '切换到浅色主题' : '切换到深色主题');
  };
  applyTheme(savedTheme === 'dark' || savedTheme === 'light' ? savedTheme : media.matches ? 'dark' : 'light');
  $('[data-theme-toggle]')?.addEventListener('click', () => {
    savedTheme = html.dataset.theme === 'dark' ? 'light' : 'dark';
    applyTheme(savedTheme);
    try { localStorage.setItem('blog-theme', savedTheme); } catch {}
  });
  media.addEventListener('change', e => { if (!savedTheme) applyTheme(e.matches ? 'dark' : 'light'); });
  const menu = $('[data-mobile-nav]');
  $('[data-menu-toggle]')?.addEventListener('click', e => {
    if (!menu) return;
    menu.hidden = !menu.hidden;
    e.currentTarget.setAttribute('aria-expanded', String(!menu.hidden));
  });
  const progress = $('.page-progress span');
  let scheduled = false;
  const scrollUpdate = () => {
    scheduled = false;
    const max = html.scrollHeight - window.innerHeight;
    if (progress) progress.style.width = `${max > 0 ? Math.min(100, window.scrollY / max * 100) : 0}%`;
  };
  window.addEventListener('scroll', () => { if (!scheduled) { scheduled = true; requestAnimationFrame(scrollUpdate); } }, { passive: true });
  window.addEventListener('resize', scrollUpdate);
  scrollUpdate();

  // Modal focus management: Escape / backdrop / close button and focus restoration.
  let activeLayer = null;
  let returnFocus = null;
  let oldOverflow = '';
  function closeLayer() {
    if (!activeLayer) return;
    activeLayer.hidden = true;
    activeLayer = null;
    document.body.style.overflow = oldOverflow;
    returnFocus?.focus();
  }
  function openLayer(layer, focusTarget) {
    if (activeLayer) closeLayer();
    returnFocus = document.activeElement;
    oldOverflow = document.body.style.overflow;
    activeLayer = layer;
    layer.hidden = false;
    document.body.style.overflow = 'hidden';
    (focusTarget || $('button', layer))?.focus();
  }
  for (const layer of $$('[data-search-layer], [data-zoom-layer]')) {
    const close = document.createElement('button');
    close.className = 'overlay-close';
    close.type = 'button';
    close.textContent = '×';
    close.setAttribute('aria-label', '关闭');
    close.addEventListener('click', closeLayer);
    layer.append(close);
    layer.addEventListener('click', e => { if (e.target === layer) closeLayer(); });
  }
  document.addEventListener('keydown', e => {
    if (!activeLayer) return;
    if (e.key === 'Escape') { e.preventDefault(); closeLayer(); }
    if (e.key === 'Tab') {
      const items = $$('button, input, a[href]', activeLayer).filter(el => !el.disabled && !el.hidden);
      if (!items.length) return;
      const first = items[0], last = items.at(-1);
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
  });

  const searchLayer = $('[data-search-layer]');
  const searchInput = $('[data-search-input]');
  const results = $('[data-search-results]');
  let searchPosts = null;
  let pendingIndex = null;
  function hint(message) {
    results.replaceChildren();
    const p = document.createElement('p'); p.className = 'search-hint'; p.textContent = message; results.append(p);
  }
  async function loadIndex() {
    if (searchPosts) return searchPosts;
    if (!pendingIndex) pendingIndex = fetch('/search.json').then(r => {
      if (!r.ok) throw new Error('搜索加载失败'); return r.json();
    }).then(data => { searchPosts = Array.isArray(data.posts) ? data.posts : []; return searchPosts; }).finally(() => { pendingIndex = null; });
    return pendingIndex;
  }
  async function search() {
    const query = searchInput.value.trim().toLocaleLowerCase();
    if (!query) return hint('输入关键词搜索文章。按 Esc 关闭。');
    hint('正在搜索…');
    try {
      const posts = await loadIndex();
      if (query !== searchInput.value.trim().toLocaleLowerCase()) return;
      const words = query.split(/\s+/).filter(Boolean);
      const matches = posts.map(p => {
        const title = String(p.title || '').toLocaleLowerCase();
        const text = [title, p.category, ...(p.tags || []), p.text].join(' ').toLocaleLowerCase();
        return { p, score: words.every(w => text.includes(w)) ? words.reduce((s, w) => s + (title.includes(w) ? 10 : 1), 0) : 0 };
      }).filter(x => x.score).sort((a, b) => b.score - a.score);
      hint(matches.length ? `找到 ${matches.length} 篇文章${matches.length > 30 ? '，显示前 30 篇' : ''}` : '没有找到相关内容，换个关键词试试。');
      for (const { p } of matches.slice(0, 30)) {
        if (!/^\/posts\//.test(String(p.url))) continue;
        const a = document.createElement('a'); a.className = 'search-result'; a.href = p.url;
        const title = document.createElement('strong'); title.textContent = p.title;
        const meta = document.createElement('small'); meta.textContent = `${p.date || ''} · ${p.category || ''}`;
        const summary = document.createElement('p'); summary.textContent = String(p.text || '').slice(0, 150);
        a.append(title, meta, summary); results.append(a);
      }
    } catch { hint('搜索索引暂时无法加载，请稍后重试。'); }
  }
  $('[data-search-open]')?.addEventListener('click', () => { openLayer(searchLayer, searchInput); search(); });
  let searchTimer;
  searchInput?.addEventListener('input', () => { clearTimeout(searchTimer); searchTimer = setTimeout(search, 160); });
  results?.setAttribute('aria-live', 'polite');

  const zoomLayer = $('[data-zoom-layer]');
  if (zoomLayer) {
    zoomLayer.setAttribute('role', 'dialog'); zoomLayer.setAttribute('aria-modal', 'true'); zoomLayer.setAttribute('aria-label', '图片预览');
    for (const img of $$('[data-zoom]')) {
      img.tabIndex = 0;
      const zoom = () => { const target = $('img', zoomLayer); target.src = img.currentSrc || img.src; target.alt = img.alt || '文章图片'; openLayer(zoomLayer); };
      img.addEventListener('click', zoom);
      img.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); zoom(); } });
    }
    $('img', zoomLayer)?.addEventListener('click', closeLayer);
  }
  const tocLinks = $$('.toc a');
  if (tocLinks.length && 'IntersectionObserver' in window) {
    const observer = new IntersectionObserver(entries => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        for (const a of tocLinks) a.classList.toggle('is-active', decodeURIComponent(a.hash.slice(1)) === entry.target.id);
      }
    }, { rootMargin: '-80px 0px -65% 0px', threshold: 0 });
    for (const a of tocLinks) {
      const heading = document.getElementById(decodeURIComponent(a.hash.slice(1)));
      if (heading) observer.observe(heading);
    }
  }
  const rotating = $('[data-rotate]');
  if (rotating && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
    try {
      const lines = JSON.parse(rotating.dataset.rotate);
      let i = 0;
      if (Array.isArray(lines) && lines.length > 1) setInterval(() => {
        if (!document.hidden) rotating.textContent = lines[++i % lines.length];
      }, 6500);
    } catch {}
  }
})();
