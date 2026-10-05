(() => {
  if (window.__igdlLoaded) return;
  window.__igdlLoaded = true;

  const BASE = location.origin;
  const SVG_NS = 'http://www.w3.org/2000/svg';
  const PATH_DOWNLOAD = 'M12 4v11m0 0-4.5-4.5M12 15l4.5-4.5M5 19.5h14';
  const PATH_CHECK = 'M5 12.5l4.5 4.5L19 7.5';
  const POST_LINK_SELECTOR = 'a[href*="/p/"], a[href*="/reel/"], a[href*="/tv/"]';

  // Remove leftovers from a previous copy of this script (e.g. after the extension reloads).
  document.querySelectorAll('.igdl-base, .igdl-toast-wrap').forEach((el) => el.remove());

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
  const alive = () => !!chrome.runtime?.id;

  function stop(e) {
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();
  }

  // ---------- UI helpers ----------

  function icon(d, cls) {
    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('class', `igdl-ico ${cls}`);
    const path = document.createElementNS(SVG_NS, 'path');
    path.setAttribute('d', d);
    svg.appendChild(path);
    return svg;
  }

  function makeButton(cls, title, withLabel = false) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = `igdl-base ${cls}`;
    b.title = title;
    b.setAttribute('aria-label', title);
    b.append(icon(PATH_DOWNLOAD, 'igdl-ico-dl'), icon(PATH_CHECK, 'igdl-ico-ok'));
    const spin = document.createElement('span');
    spin.className = 'igdl-spin';
    b.appendChild(spin);
    if (withLabel) {
      const label = document.createElement('span');
      label.className = 'igdl-label';
      b.appendChild(label);
    }
    // Keep Instagram from treating clicks on our button as clicks on the post.
    for (const t of ['pointerdown', 'pointerup', 'mousedown', 'mouseup', 'touchstart', 'touchend', 'dblclick']) {
      b.addEventListener(t, (e) => e.stopPropagation());
    }
    return b;
  }

  function flash(btn, cls) {
    if (!btn) return;
    btn.classList.add(cls);
    setTimeout(() => btn.classList.remove(cls), 1600);
  }

  let toastWrap;
  function toast(text, { kind = 'info', timeout = 3500, action } = {}) {
    if (!toastWrap?.isConnected) {
      toastWrap = document.createElement('div');
      toastWrap.className = 'igdl-toast-wrap';
      document.body.appendChild(toastWrap);
    }
    const el = document.createElement('div');
    el.className = `igdl-toast igdl-${kind}`;
    const span = document.createElement('span');
    span.textContent = text;
    el.appendChild(span);
    let actionBtn;
    if (action) {
      actionBtn = document.createElement('button');
      actionBtn.type = 'button';
      actionBtn.textContent = action.label;
      actionBtn.addEventListener('click', action.onClick);
      el.appendChild(actionBtn);
    }
    toastWrap.appendChild(el);

    const api = {
      set(t, k) {
        span.textContent = t;
        if (k) el.className = `igdl-toast igdl-${k}`;
      },
      removeAction() {
        actionBtn?.remove();
      },
      close(delay = 0) {
        setTimeout(() => {
          el.classList.add('igdl-out');
          setTimeout(() => el.remove(), 250);
        }, delay);
      },
    };
    if (timeout) api.close(timeout);
    return api;
  }

  // ---------- Downloading ----------

  async function send(msg) {
    if (!alive()) throw new Error('The extension was updated. Refresh this page to keep using it.');
    const res = await chrome.runtime.sendMessage(msg);
    if (!res?.ok) throw new Error(res?.error || 'Something went wrong.');
    return res.result;
  }

  const downloadPosts = (posts) => send({ type: 'download', posts });

  async function downloadShortcode(shortcode) {
    return downloadPosts(await IG.resolve({ type: 'post', shortcode }, BASE));
  }

  async function run(btn, task) {
    if (btn?.classList.contains('igdl-busy')) return;
    btn?.classList.add('igdl-busy');
    try {
      const count = await task();
      if (count) {
        toast(`Downloading ${plural(count, 'file')}`, { kind: 'ok' });
        flash(btn, 'igdl-done');
      }
    } catch (e) {
      toast(e.message || String(e), { kind: 'error', timeout: 6000 });
      flash(btn, 'igdl-fail');
    } finally {
      btn?.classList.remove('igdl-busy');
    }
  }

  const basename = (url) => {
    try {
      return new URL(url, location.href).pathname.split('/').pop();
    } catch {
      return '';
    }
  };

  // Highlights (and some story views) don't put the current item's id in the URL,
  // so match the on-screen image/poster against the story items' CDN file names.
  function matchVisibleStory(posts) {
    const visible = [...document.querySelectorAll('img, video')]
      .map((el) => ({ el, r: el.getBoundingClientRect() }))
      .filter(({ r }) => r.width >= 150 && r.height >= 150 && r.bottom > 0 && r.top < innerHeight && r.right > 0 && r.left < innerWidth)
      .sort((a, b) => b.r.width * b.r.height - a.r.width * a.r.height);

    for (const { el } of visible) {
      const names = new Set([el.currentSrc, el.src, el.poster].filter(Boolean).map(basename));
      for (const part of (el.srcset || '').split(',')) {
        const u = part.trim().split(' ')[0];
        if (u) names.add(basename(u));
      }
      names.delete('');
      const hit = posts.find((p) => p.media.some((m) => names.has(basename(m.url)) || names.has(basename(m.thumb || ''))));
      if (hit) return hit;
    }
    return null;
  }

  async function downloadStory(parsed) {
    let posts = await IG.resolve(parsed, BASE);
    if (posts.length > 1) {
      const match = matchVisibleStory(posts);
      if (match) posts = [match];
      else if (!confirm(`Couldn't tell which story is on screen.\nDownload all ${posts.length} stories instead?`)) return 0;
    }
    return downloadPosts(posts);
  }

  // ---------- Finding posts on the page ----------

  function postLinkShortcode(a) {
    const p = IG.parseUrl(a.getAttribute('href') || '');
    return p?.type === 'post' ? p.shortcode : null;
  }

  // Thumbnail links (profile grid, explore, "more posts") as opposed to small text links.
  function gridAnchors(root = document) {
    return [...root.querySelectorAll(POST_LINK_SELECTOR)].filter((a) => {
      if (!postLinkShortcode(a)) return false;
      const r = a.getBoundingClientRect();
      return r.width >= 100 && r.height >= 100;
    });
  }

  function postArticles(grid = gridAnchors()) {
    return [...document.querySelectorAll('article')].filter((art) => grid.filter((a) => art.contains(a)).length < 2);
  }

  function articleShortcode(article) {
    for (const a of article.querySelectorAll(POST_LINK_SELECTOR)) {
      const sc = postLinkShortcode(a);
      if (sc) return sc;
    }
    const p = IG.parseUrl(location.href);
    return p?.type === 'post' ? p.shortcode : null;
  }

  function largestMedia(article) {
    const ar = article.getBoundingClientRect();
    let bestEl = null;
    let bestArea = 150 * 150;
    let bestRect = null;
    for (const el of article.querySelectorAll('img, video')) {
      const r = el.getBoundingClientRect();
      const left = Math.max(r.left, ar.left);
      const right = Math.min(r.right, ar.right);
      const top = Math.max(r.top, ar.top);
      const bottom = Math.min(r.bottom, ar.bottom);
      const a = Math.max(0, right - left) * Math.max(0, bottom - top);
      if (a > bestArea) {
        bestEl = el;
        bestArea = a;
        bestRect = { left, right, top, bottom };
      }
    }
    return bestEl ? { el: bestEl, rect: bestRect } : null;
  }

  function mostVisibleArticle() {
    let best = null;
    let bestArea = 0;
    for (const art of postArticles()) {
      const r = art.getBoundingClientRect();
      const h = Math.min(r.bottom, innerHeight) - Math.max(r.top, 0);
      const w = Math.min(r.right, innerWidth) - Math.max(r.left, 0);
      if (h > 0 && w > 0 && h * w > bestArea) {
        best = art;
        bestArea = h * w;
      }
    }
    return best;
  }

  async function downloadCurrent(btn) {
    const parsed = IG.parseUrl(location.href);
    if (parsed?.type === 'story' || parsed?.type === 'highlight') return run(btn, () => downloadStory(parsed));
    if (parsed?.type === 'post') return run(btn, () => downloadShortcode(parsed.shortcode));

    const article = mostVisibleArticle();
    const sc = article && articleShortcode(article);
    if (sc) return run(btn || article.querySelector(':scope > .igdl-btn'), () => downloadShortcode(sc));
    toast('Nothing to download here. Scroll to a post, or open a post, reel or story.', { kind: 'error' });
  }

  // ---------- Bulk ----------

  const BULK_DELAY_MS = [2000, 5000];
  const BULK_BREAK_EVERY = [20, 30];
  const BULK_BREAK_MS = [30000, 60000];

  let bulkRunning = false;

  const randomInt = (min, max) => Math.floor(min + Math.random() * (max - min + 1));

  // Sleeps in short slices so Cancel takes effect right away; onTick receives seconds remaining.
  async function wait(ms, isCancelled, onTick) {
    const end = Date.now() + ms;
    while (!isCancelled() && Date.now() < end) {
      onTick?.(Math.ceil((end - Date.now()) / 1000));
      await sleep(Math.min(250, end - Date.now()));
    }
  }

  function startBulk() {
    if (bulkRunning) {
      toast('A bulk download is already running.');
      return 0;
    }
    const grid = gridAnchors();
    const codes = new Set(grid.map(postLinkShortcode));
    for (const art of postArticles(grid)) {
      const sc = articleShortcode(art);
      if (sc) codes.add(sc);
    }
    const here = IG.parseUrl(location.href);
    if (here?.type === 'post') codes.add(here.shortcode);

    const list = [...codes].filter(Boolean);
    if (!list.length) {
      toast('No posts found on this page.', { kind: 'error' });
      return 0;
    }
    bulk(list);
    return list.length;
  }

  async function bulk(list) {
    bulkRunning = true;
    let cancelled = false;
    let files = 0;
    let failed = 0;
    let stopReason = '';
    const t = toast(`Downloading 0/${list.length} posts…`, {
      timeout: 0,
      action: { label: 'Cancel', onClick: () => (cancelled = true) },
    });

    const isCancelled = () => cancelled;
    let nextBreakAt = randomInt(...BULK_BREAK_EVERY);

    for (let i = 0; i < list.length && !cancelled; i++) {
      try {
        files += await downloadShortcode(list[i]);
      } catch (e) {
        failed++;
        if (/rate-limiting|updated/.test(e.message)) {
          stopReason = e.message;
          break;
        }
      }
      const progress = `Downloading ${i + 1}/${list.length} posts…`;
      t.set(progress);
      if (i === list.length - 1) break;

      // Irregular, human-like pacing: Instagram flags high volume and perfectly regular request intervals.
      if (i + 1 >= nextBreakAt) {
        nextBreakAt += randomInt(...BULK_BREAK_EVERY);
        await wait(randomInt(...BULK_BREAK_MS), isCancelled, (s) => t.set(`${progress} Short break, resuming in ${s}s`));
      } else {
        await wait(randomInt(...BULK_DELAY_MS), isCancelled);
      }
    }

    t.removeAction();
    const summary = `${plural(files, 'file')} downloaded${failed ? `, ${failed} failed` : ''}`;
    if (stopReason) t.set(`Stopped: ${stopReason} (${summary})`, 'error');
    else if (cancelled) t.set(`Cancelled. ${summary}.`, 'info');
    else t.set(`Done! ${summary}.`, failed ? 'error' : 'ok');
    t.close(6000);
    bulkRunning = false;
  }

  // ---------- Injecting buttons ----------

  function injectArticle(article) {
    let btn = article.querySelector(':scope > .igdl-btn');
    const media = largestMedia(article);
    if (!media) {
      btn?.remove();
      return;
    }
    if (!btn) {
      if (getComputedStyle(article).position === 'static') article.classList.add('igdl-article');
      btn = makeButton('igdl-btn', 'Download this post');
      btn.addEventListener('click', (e) => {
        stop(e);
        const sc = articleShortcode(article);
        if (!sc) return toast("Couldn't find this post's link.", { kind: 'error' });
        run(btn, () => downloadShortcode(sc));
      });
      article.appendChild(btn);
    }
    const ar = article.getBoundingClientRect();
    btn.style.top = `${Math.max(0, media.rect.top - ar.top) + 12}px`;
    btn.style.right = `${Math.max(0, ar.right - media.rect.right) + 12}px`;
  }

  function injectGrid(a) {
    if (a.querySelector(':scope > .igdl-grid-btn')) return;
    const sc = postLinkShortcode(a);
    if (!sc) return;
    if (getComputedStyle(a).position === 'static') a.classList.add('igdl-rel');
    const btn = makeButton('igdl-grid-btn', 'Download');
    btn.addEventListener('click', (e) => {
      stop(e);
      run(btn, () => downloadShortcode(sc));
    });
    a.appendChild(btn);
  }

  let fab;
  function updateFab() {
    const p = IG.parseUrl(location.href);
    if (!p) {
      if (fab) fab.hidden = true;
      return;
    }
    if (!fab?.isConnected) {
      fab = makeButton('igdl-fab', 'Download', true);
      fab.addEventListener('click', (e) => {
        stop(e);
        downloadCurrent(fab);
      });
      document.body.appendChild(fab);
    }
    const kind = p.type === 'post' ? (p.isReel ? 'reel' : 'post') : 'story';
    fab.querySelector('.igdl-label').textContent = `Download ${kind}`;
    fab.title = `Download this ${kind} (Alt+Shift+D)`;
    fab.hidden = false;
  }

  let observer;
  function teardown() {
    observer?.disconnect();
    clearInterval(urlTimer);
    document.querySelectorAll('.igdl-base').forEach((el) => el.remove());
  }

  function scan() {
    if (!alive()) return teardown();
    const grid = gridAnchors();
    for (const art of postArticles(grid)) injectArticle(art);
    for (const a of grid) injectGrid(a);
    updateFab();
  }

  let scanTimer;
  const scheduleScan = () => {
    clearTimeout(scanTimer);
    scanTimer = setTimeout(scan, 300);
  };

  observer = new MutationObserver(scheduleScan);
  observer.observe(document.body, { childList: true, subtree: true });
  addEventListener('resize', scheduleScan);

  let lastHref = location.href;
  const urlTimer = setInterval(() => {
    if (location.href !== lastHref) {
      lastHref = location.href;
      scheduleScan();
    }
  }, 500);

  scan();

  // ---------- Messages from popup / background ----------

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg.type === 'resolve') {
      IG.resolve(IG.parseUrl(msg.url), BASE).then(
        (posts) => sendResponse({ ok: true, posts }),
        (e) => sendResponse({ ok: false, error: e.message || String(e) }),
      );
      return true;
    }
    if (msg.type === 'downloadCurrent') {
      downloadCurrent();
      sendResponse({ ok: true });
    } else if (msg.type === 'downloadAllLoaded') {
      sendResponse({ ok: true, count: startBulk() });
    }
  });
})();
