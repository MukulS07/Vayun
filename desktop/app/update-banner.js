// A small "update available" banner, shown on the start screen and the main workspace screen.
// Fed by `api.on('update:available', info)` — the main process checks once on launch and pushes the
// result here; nothing is polled from the renderer. Dismissing a version remembers it for the session
// only, so the banner reappears next launch if still out of date.
(function () {
  if (!window.api || typeof window.api.on !== 'function') return;

  function openDownload(url) {
    if (typeof window.api.openExternal === 'function') window.api.openExternal(url);
    else window.open(url, '_blank', 'noopener');
  }

  function show(info) {
    if (!info || !info.available || !info.downloadUrl) return;
    if (sessionStorage.getItem('vayun-update-dismissed') === info.version) return;
    if (document.getElementById('vayun-update-banner')) return;

    const bar = document.createElement('div');
    bar.id = 'vayun-update-banner';
    bar.setAttribute('role', 'status');
    Object.assign(bar.style, {
      position: 'fixed', left: '0', right: '0', bottom: '0', zIndex: '99999',
      display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '14px',
      padding: '9px 16px', fontSize: '12.5px', fontFamily: 'inherit',
      background: '#16251c', color: '#d8f3df', borderTop: '1px solid #2c4a37',
    });

    const text = document.createElement('span');
    text.textContent = `Vayun ${info.version} is available — you're on ${info.currentVersion}.`;

    const link = document.createElement('a');
    link.textContent = 'Download';
    link.href = '#';
    Object.assign(link.style, { color: '#7fe3a0', fontWeight: '600', textDecoration: 'none', cursor: 'pointer' });
    link.addEventListener('click', e => { e.preventDefault(); openDownload(info.downloadUrl); });

    const close = document.createElement('button');
    close.type = 'button';
    close.textContent = '✕';
    close.setAttribute('aria-label', 'Dismiss update notice');
    Object.assign(close.style, {
      background: 'none', border: 'none', color: '#9db5a7', cursor: 'pointer',
      fontSize: '13px', lineHeight: '1', padding: '4px',
    });
    close.addEventListener('click', () => {
      bar.remove();
      sessionStorage.setItem('vayun-update-dismissed', info.version);
    });

    bar.append(text, link, close);
    document.body.appendChild(bar);
  }

  window.api.on('update:available', show);
  // The main process may have found an update before this page finished loading (e.g. after
  // navigating from start.html to index.html) — ask once in case the push already happened.
  if (typeof window.api.checkForUpdate === 'function') window.api.checkForUpdate().then(show);
})();
