const DEFAULT_SETTINGS = { perUserFolder: true, saveAs: false };

const $ = (id) => document.getElementById(id);
const statusEl = $('status');

function setStatus(text, kind = '') {
  statusEl.textContent = text;
  statusEl.className = kind;
}

async function call(msg) {
  const res = await chrome.runtime.sendMessage(msg);
  if (!res?.ok) throw new Error(res?.error || 'Something went wrong.');
  return res.result;
}

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

async function withBusy(btn, fn) {
  btn.disabled = true;
  try {
    await fn();
  } catch (e) {
    setStatus(e.message || String(e), 'err');
  } finally {
    btn.disabled = false;
  }
}

$('link-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const url = $('link').value.trim();
  if (!url) return setStatus('Paste an Instagram link first.', 'err');
  withBusy($('link-btn'), async () => {
    setStatus('Fetching…');
    const count = await call({ type: 'downloadUrl', url });
    setStatus(`Downloading ${plural(count, 'file')}.`, 'ok');
    $('link').value = '';
  });
});

async function init() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const onInstagram = !!tab?.url && /^https:\/\/(www\.)?instagram\.com\//.test(tab.url);

  for (const id of ['current-btn', 'bulk-btn']) {
    $(id).disabled = !onInstagram;
    if (!onInstagram) $(id).title = 'Open instagram.com in this tab to use this';
  }

  $('current-btn').addEventListener('click', () =>
    withBusy($('current-btn'), async () => {
      await call({ type: 'tabAction', tabId: tab.id, action: 'downloadCurrent' });
      window.close();
    }),
  );

  $('bulk-btn').addEventListener('click', () =>
    withBusy($('bulk-btn'), async () => {
      const res = await call({ type: 'tabAction', tabId: tab.id, action: 'downloadAllLoaded' });
      if (!res?.count) throw new Error('No posts found on this page.');
      setStatus(`Downloading ${plural(res.count, 'post')}. Progress is shown on the page.`, 'ok');
    }),
  );

  if (!onInstagram) setStatus('Tip: open instagram.com to get download buttons on every post.');
  $('link').focus();

  const settings = await chrome.storage.sync.get(DEFAULT_SETTINGS);
  for (const key of Object.keys(DEFAULT_SETTINGS)) {
    $(key).checked = !!settings[key];
    $(key).addEventListener('change', () => chrome.storage.sync.set({ [key]: $(key).checked }));
  }
}

init();
