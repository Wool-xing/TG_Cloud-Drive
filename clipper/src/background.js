// ── TG Cloud Clipper — Service Worker ────────────────────────────────────────
// Handles: auth token management, file upload to TG Cloud API

const DEFAULT_SERVER = '';

chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.get(['serverUrl'], (s) => {
    if (!s.serverUrl) chrome.storage.local.set({ serverUrl: DEFAULT_SERVER });
  });
});

// Listen for upload requests from popup
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type === 'UPLOAD') {
    handleUpload(msg.payload).then(sendResponse).catch(e => sendResponse({ error: e.message }));
    return true; // keep channel open for async response
  }
});

async function handleUpload({ serverUrl, token, name, mimeType, content, parentPath }) {
  if (!serverUrl || !token) throw new Error('Server URL and token required');
  const base = serverUrl.replace(/\/$/, '');

  // Step 1: verify auth and get user info
  const meRes = await fetch(`${base}/api/users/me`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!meRes.ok) throw new Error(`Auth failed: ${meRes.status}`);

  // Step 2: resolve parent folder (default to root)
  let parentId = null;
  if (parentPath) {
    try {
      const listRes = await fetch(`${base}/api/files?path=${encodeURIComponent(parentPath)}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (listRes.ok) {
        const data = await listRes.json();
        if (data?.nodes?.length) parentId = data.nodes[0].id;
      }
    } catch {}
  }

  // Step 3: upload file
  const body = new FormData();
  const blob = new Blob([content], { type: mimeType || 'text/html' });
  body.append('file', blob, name || 'clipped.html');
  body.append('parentId', parentId || '');
  body.append('type', 'file');

  const uploadRes = await fetch(`${base}/api/files/upload`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body,
  });

  if (!uploadRes.ok) {
    const err = await uploadRes.text();
    throw new Error(`Upload failed: ${uploadRes.status} ${err}`);
  }

  return { success: true };
}
