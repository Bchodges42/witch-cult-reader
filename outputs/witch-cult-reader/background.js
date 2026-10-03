// Witch Cult Reader - local TTS proxy. Content scripts on the https site cannot
// fetch a local http server directly; the service worker can, via host_permissions.
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || msg.type !== 'wcr-proxy') return;
  (async () => {
    try {
      const target = new URL(msg.url);
      if (!['127.0.0.1', 'localhost', '[::1]'].includes(target.hostname)) {
        sendResponse({ok: false, status: 0, error: 'blocked: only local servers are allowed'});
        return;
      }
      const r = await fetch(msg.url, msg.init || {});
      const ctype = r.headers.get('content-type') || '';
      let body;
      if (ctype.startsWith('audio/') || ctype.includes('octet-stream')) body = await r.arrayBuffer();
      else if (ctype.includes('json')) body = await r.json();
      else body = await r.text();
      sendResponse({ok: r.ok, status: r.status, contentType: ctype, body});
    } catch (e) { sendResponse({ok: false, status: 0, error: String(e)}); }
  })();
  return true;
});
