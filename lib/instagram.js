// Shared between the content script (runs on instagram.com) and the background
// service worker (loaded with importScripts), so it must not touch `window`.
(() => {
  const APP_ID = '936619743392459';
  const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

  const HIGHLIGHT_RE = /\/stories\/highlights\/(\d+)/;
  const STORY_RE = /\/stories\/([^/?#]+)(?:\/(\d+))?/;
  const POST_RE = /\/(?:p|reel|reels|tv)\/([A-Za-z0-9_-]+)/;

  class IGError extends Error {}

  function parseUrl(url) {
    let u;
    try {
      u = new URL(url, 'https://www.instagram.com');
    } catch {
      return null;
    }
    if (!/(^|\.)instagram\.com$/.test(u.hostname)) return null;
    const path = u.pathname;
    let m;
    if ((m = path.match(HIGHLIGHT_RE))) return { type: 'highlight', highlightId: m[1] };
    if ((m = path.match(STORY_RE))) return { type: 'story', username: m[1], mediaId: m[2] || null };
    if ((m = path.match(POST_RE))) return { type: 'post', shortcode: m[1], isReel: /\/reels?\//.test(path) };
    return null;
  }

  function shortcodeToMediaId(shortcode) {
    // Private-account shortcodes carry a 28-char suffix after the real id.
    const code = shortcode.length > 28 ? shortcode.slice(0, -28) : shortcode;
    let id = 0n;
    for (const ch of code) {
      const i = ALPHABET.indexOf(ch);
      if (i < 0) throw new IGError(`Invalid shortcode: ${shortcode}`);
      id = id * 64n + BigInt(i);
    }
    return id.toString();
  }

  function getCookie(name) {
    if (typeof document === 'undefined') return null;
    const m = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`));
    return m ? decodeURIComponent(m[1]) : null;
  }

  async function apiGet(base, path) {
    const headers = {
      Accept: 'application/json',
      'X-IG-App-ID': APP_ID,
      'X-Requested-With': 'XMLHttpRequest',
    };
    const csrf = getCookie('csrftoken');
    if (csrf) headers['X-CSRFToken'] = csrf;

    let res;
    try {
      res = await fetch(base + path, { headers, credentials: 'include' });
    } catch {
      throw new IGError('Network error while contacting Instagram.');
    }
    if (res.status === 401 || res.status === 403) {
      throw new IGError('Instagram refused the request. Make sure you are logged in to instagram.com.');
    }
    if (res.status === 404) throw new IGError('Not found. The post may be deleted, or private to you.');
    if (res.status === 429) throw new IGError('Instagram is rate-limiting you. Wait a few minutes and try again.');
    if (!res.ok) throw new IGError(`Instagram returned HTTP ${res.status}.`);

    const type = res.headers.get('content-type') || '';
    if (!type.includes('json')) {
      throw new IGError('Instagram returned a login page instead of data. Log in to instagram.com and try again.');
    }
    const data = await res.json();
    if (data?.require_login) throw new IGError('Log in to instagram.com to download this.');
    return data;
  }

  const area = (v) => (v.width || 0) * (v.height || 0);
  const best = (versions) => [...versions].sort((a, b) => area(b) - area(a))[0]?.url;

  function mediaFromNode(node) {
    const thumb = node.image_versions2?.candidates?.length ? best(node.image_versions2.candidates) : node.display_url;
    if (node.video_versions?.length) return { type: 'video', url: best(node.video_versions), thumb };
    if (node.is_video && node.video_url) return { type: 'video', url: node.video_url, thumb };
    if (thumb) return { type: 'image', url: thumb, thumb };
    return null;
  }

  function normalizeApiItem(item, fallbackUser) {
    const nodes = item.carousel_media?.length ? item.carousel_media : [item];
    return {
      username: item.user?.username || fallbackUser || 'instagram',
      code: item.code || String(item.pk),
      pk: String(item.pk ?? ''),
      takenAt: item.taken_at || null,
      media: nodes.map(mediaFromNode).filter(Boolean),
    };
  }

  function normalizeGraphql(sm) {
    const nodes = sm.edge_sidecar_to_children?.edges?.map((e) => e.node) || [sm];
    return {
      username: sm.owner?.username || 'instagram',
      code: sm.shortcode,
      pk: String(sm.id ?? ''),
      takenAt: sm.taken_at_timestamp || null,
      media: nodes.map(mediaFromNode).filter(Boolean),
    };
  }

  async function resolvePost(shortcode, base) {
    let firstError;
    try {
      const data = await apiGet(base, `/api/v1/media/${shortcodeToMediaId(shortcode)}/info/`);
      if (data.items?.[0]) return { ...normalizeApiItem(data.items[0]), code: shortcode };
    } catch (e) {
      firstError = e;
      if (/rate-limiting/.test(e.message)) throw e;
    }
    try {
      const data = await apiGet(base, `/p/${shortcode}/?__a=1&__d=dis`);
      if (data.items?.[0]) return { ...normalizeApiItem(data.items[0]), code: shortcode };
      const sm = data.graphql?.shortcode_media;
      if (sm) return normalizeGraphql(sm);
    } catch (e) {
      firstError = firstError || e;
    }
    throw firstError || new IGError("Couldn't find any media in this post.");
  }

  async function resolveReel(reelId, base) {
    const data = await apiGet(base, `/api/v1/feed/reels_media/?reel_ids=${encodeURIComponent(reelId)}`);
    const reel = data.reels?.[reelId] || data.reels_media?.[0];
    const items = reel?.items || [];
    if (!items.length) throw new IGError('No stories found. They may have expired.');
    return items.map((it) => {
      const post = normalizeApiItem(it, reel.user?.username);
      return { ...post, code: post.pk };
    });
  }

  async function resolveUserStories(username, base) {
    const data = await apiGet(base, `/api/v1/users/web_profile_info/?username=${encodeURIComponent(username)}`);
    const userId = data?.data?.user?.id;
    if (!userId) throw new IGError(`Couldn't find the user "${username}".`);
    return resolveReel(userId, base);
  }

  // Returns an array of posts: [{ username, code, pk, takenAt, media: [{type, url, thumb}] }]
  async function resolve(parsed, base) {
    if (!parsed) throw new IGError("That doesn't look like an Instagram post, reel or story link.");
    if (parsed.type === 'post') return [await resolvePost(parsed.shortcode, base)];
    if (parsed.type === 'highlight') return resolveReel(`highlight:${parsed.highlightId}`, base);
    if (parsed.type === 'story') {
      const items = await resolveUserStories(parsed.username, base);
      const exact = parsed.mediaId && items.find((p) => p.pk === parsed.mediaId);
      return exact ? [exact] : items;
    }
    throw new IGError('Unsupported link.');
  }

  const sanitize = (s) => String(s).replace(/[^\w.-]+/g, '_').slice(0, 80) || 'instagram';

  function extFromUrl(url) {
    try {
      const m = new URL(url).pathname.match(/\.(jpe?g|png|webp|heic|mp4|mov|m4v)$/i);
      return m ? m[1].toLowerCase() : null;
    } catch {
      return null;
    }
  }

  function buildDownloads(post, { perUserFolder = true } = {}) {
    const user = sanitize(post.username);
    const date = post.takenAt ? new Date(post.takenAt * 1000).toISOString().slice(0, 10).replace(/-/g, '') : '';
    const stem = [user, date, sanitize(post.code)].filter(Boolean).join('_');
    const many = post.media.length > 1;
    return post.media.map((m, i) => {
      const ext = extFromUrl(m.url) || (m.type === 'video' ? 'mp4' : 'jpg');
      const name = `${stem}${many ? `_${i + 1}` : ''}.${ext}`;
      return { url: m.url, filename: `Instagram/${perUserFolder ? `${user}/` : ''}${name}` };
    });
  }

  globalThis.IG = { parseUrl, resolve, buildDownloads, IGError };
})();
