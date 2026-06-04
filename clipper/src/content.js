// ── TG Cloud Clipper — Content Script ─────────────────────────────────────────
// Injected into page to extract: full page HTML, selection, or bookmark info

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type === 'EXTRACT') {
    const result = extract(msg.mode);
    sendResponse(result);
    return true;
  }
});

function extract(mode) {
  switch (mode) {
    case 'fullpage': {
      const clone = document.documentElement.cloneNode(true);
      // Remove script/style/img src references to keep it self-contained-simple
      clone.querySelectorAll('script, style, iframe, noscript, nav, footer, .ad, .ads').forEach(el => el.remove());
      const html = '<!DOCTYPE html>\n' + clone.outerHTML;
      return {
        title: document.title || 'Untitled',
        url: location.href,
        content: html,
        mimeType: 'text/html',
        name: sanitizeFilename(document.title || 'clipped') + '.html',
      };
    }

    case 'selection': {
      const sel = window.getSelection();
      if (!sel || sel.isCollapsed) return { error: 'No text selected' };
      const container = document.createElement('div');
      for (let i = 0; i < sel.rangeCount; i++) {
        container.appendChild(sel.getRangeAt(i).cloneContents());
      }
      return {
        title: document.title || 'Selection',
        url: location.href,
        content: container.innerHTML,
        mimeType: 'text/html',
        name: sanitizeFilename(document.title || 'selection') + '-clip.html',
      };
    }

    case 'bookmark': {
      const desc = (document.querySelector('meta[name="description"]')?.getAttribute('content')) || '';
      return {
        title: document.title || 'Bookmark',
        url: location.href,
        content: `<h1>${document.title || 'Untitled'}</h1>\n<p><a href="${location.href}">${location.href}</a></p>\n<p>${desc}</p>`,
        mimeType: 'text/html',
        name: sanitizeFilename(document.title || 'bookmark') + '.html',
      };
    }

    default:
      return { error: 'Unknown mode: ' + mode };
  }
}

function sanitizeFilename(name) {
  return name.replace(/[<>:"/\\|?*\x00-\x1f]/g, '').slice(0, 100).trim() || 'untitled';
}
