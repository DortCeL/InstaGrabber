importScripts('lib/instagram.js');

const DEFAULT_SETTINGS = { perUserFolder: true, saveAs: false };
const IG_ORIGIN = 'https://www.instagram.com';

const getSettings = () => chrome.storage.sync.get(DEFAULT_SETTINGS);
const isInstagramTab = (tab) => !!tab?.url && /^https:\/\/(www\.)?instagram\.com\//.test(tab.url);

async function downloadPosts(posts) {
  const settings = await getSettings();
  const files = posts.flatMap((post) => IG.buildDownloads(post, settings));
  if (!files.length) throw new Error('No photos or videos found.');
  for (const file of files) {
    await chrome.downloads.download({
      url: file.url,
      filename: file.filename,
      saveAs: settings.saveAs,
      conflictAction: 'uniquify',
    });
  }
  return files.length;
}

// Instagram tabs opened before the extension was installed/reloaded don't have the
// content script yet, so inject it on demand.
async function sendToTab(tabId, msg) {
  try {
    return await chrome.tabs.sendMessage(tabId, msg);
  } catch {
    await chrome.scripting.insertCSS({ target: { tabId }, files: ['content.css'] });
    await chrome.scripting.executeScript({ target: { tabId }, files: ['lib/instagram.js', 'content.js'] });
    return chrome.tabs.sendMessage(tabId, msg);
  }
}

// Prefer resolving inside an open Instagram tab: requests made from the page itself
// look exactly like Instagram's own, which is the most reliable option.
async function resolveUrl(url, preferredTab) {
  const parsed = IG.parseUrl(url);
  if (!parsed) throw new Error("That doesn't look like an Instagram post, reel or story link.");

  const tabs = await chrome.tabs.query({ url: ['https://www.instagram.com/*', 'https://instagram.com/*'] });
  if (isInstagramTab(preferredTab)) tabs.unshift(preferredTab);

  for (const tab of tabs) {
    if (tab.discarded) continue;
    let res;
    try {
      res = await sendToTab(tab.id, { type: 'resolve', url });
    } catch {
      continue;
    }
    if (res?.ok) return res.posts;
    if (res?.error) throw new Error(res.error);
  }
  return IG.resolve(parsed, IG_ORIGIN);
}

async function tabAction(tabId, action) {
  const tab = await chrome.tabs.get(tabId);
  if (!isInstagramTab(tab)) throw new Error('Open instagram.com in this tab first.');
  return sendToTab(tabId, { type: action });
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  const handlers = {
    download: () => downloadPosts(msg.posts),
    downloadUrl: async () => downloadPosts(await resolveUrl(msg.url, sender.tab)),
    tabAction: () => tabAction(msg.tabId, msg.action),
  };
  const handler = handlers[msg.type];
  if (!handler) return false;
  Promise.resolve()
    .then(handler)
    .then(
      (result) => sendResponse({ ok: true, result }),
      (e) => sendResponse({ ok: false, error: e?.message || String(e) }),
    );
  return true;
});

// ---------- Context menu ----------

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: 'igdl-link',
      title: 'Download Instagram media',
      contexts: ['link'],
      targetUrlPatterns: [
        '*://*.instagram.com/p/*',
        '*://*.instagram.com/*/p/*',
        '*://*.instagram.com/reel/*',
        '*://*.instagram.com/*/reel/*',
        '*://*.instagram.com/reels/*',
        '*://*.instagram.com/tv/*',
        '*://*.instagram.com/stories/*',
      ],
    });
    chrome.contextMenus.create({
      id: 'igdl-page',
      title: 'Download this post / reel / story',
      contexts: ['page', 'image', 'video'],
      documentUrlPatterns: ['*://*.instagram.com/*'],
    });
  });
});

function notifyError(tab, message) {
  if (!isInstagramTab(tab)) return;
  chrome.scripting
    .executeScript({ target: { tabId: tab.id }, func: (m) => alert(`InstaGrabber: ${m}`), args: [message] })
    .catch(() => {});
}

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  try {
    if (info.menuItemId === 'igdl-link') {
      await downloadPosts(await resolveUrl(info.linkUrl, tab));
    } else if (info.menuItemId === 'igdl-page' && tab?.id != null) {
      await tabAction(tab.id, 'downloadCurrent');
    }
  } catch (e) {
    notifyError(tab, e?.message || String(e));
  }
});

// ---------- Keyboard shortcut ----------

chrome.commands.onCommand.addListener(async (command, tab) => {
  if (command !== 'download-current') return;
  const target = tab || (await chrome.tabs.query({ active: true, currentWindow: true }))[0];
  if (!isInstagramTab(target)) return;
  try {
    await tabAction(target.id, 'downloadCurrent');
  } catch (e) {
    notifyError(target, e?.message || String(e));
  }
});
