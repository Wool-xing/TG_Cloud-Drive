// ── TG Cloud Clipper — Popup ──────────────────────────────────────────────────

const $ = id => document.getElementById(id);

// Load saved settings
chrome.storage.local.get(['serverUrl', 'token'], (s) => {
  if (s.serverUrl) $('serverUrl').value = s.serverUrl;
  if (s.token) $('token').value = s.token;
});

$('saveToken').addEventListener('click', () => {
  chrome.storage.local.set({
    serverUrl: $('serverUrl').value.trim(),
    token: $('token').value.trim(),
  }, () => showStatus('Saved', 'success'));
});

$('clipBtn').addEventListener('click', async () => {
  const serverUrl = $('serverUrl').value.trim();
  const token = $('token').value.trim();
  const mode = $('mode').value;
  const folder = $('folder').value.trim();

  if (!serverUrl || !token) {
    showStatus('Set server URL and token first', 'error');
    return;
  }

  setLoading(true);
  hideStatus();

  try {
    // Step 1: extract content from active tab via content script
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab || !tab.id) throw new Error('No active tab');

    // Inject content script if needed, then extract
    const extractResult = await chrome.tabs.sendMessage(tab.id, { type: 'EXTRACT', mode });
    if (extractResult?.error) throw new Error(extractResult.error);

    // Step 2: upload to TG Cloud via background service worker
    const uploadResult = await chrome.runtime.sendMessage({
      type: 'UPLOAD',
      payload: {
        serverUrl,
        token,
        name: extractResult.name,
        mimeType: extractResult.mimeType,
        content: extractResult.content,
        parentPath: folder || '',
      },
    });

    if (uploadResult?.error) throw new Error(uploadResult.error);
    showStatus('Clipped! ' + extractResult.title.slice(0, 40), 'success');
  } catch (err) {
    showStatus(err.message, 'error');
  } finally {
    setLoading(false);
  }
});

function setLoading(loading) {
  $('clipBtn').disabled = loading;
  $('btnLabel').classList.toggle('hidden', loading);
  $('spinner').classList.toggle('hidden', !loading);
}

function showStatus(msg, type) {
  const el = $('status');
  el.textContent = msg;
  el.className = `status ${type}`;
  el.classList.remove('hidden');
}

function hideStatus() {
  $('status').classList.add('hidden');
}
