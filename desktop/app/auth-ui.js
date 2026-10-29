// Firebase Google Auth UI for Vayun (Start Page & Workspace Sidebar)
(function () {
  const G_SVG = `<svg class="g-ico" viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
    <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
    <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
    <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"/>
    <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"/>
  </svg>`;

  let authState = {
    isConfigured: false,
    missing: [],
    user: null,
    config: {},
  };

  async function refreshState() {
    if (!window.api?.authStatus) return;
    try {
      authState = await window.api.authStatus();
      renderAll();
    } catch (e) {
      console.warn('Could not load auth status', e);
    }
  }

  function getAvatarHtml(user, size = 28) {
    if (user?.photoURL) {
      return `<img src="${user.photoURL}" alt="" class="auth-avatar" style="width:${size}px;height:${size}px;" onerror="this.style.display='none';this.nextElementSibling.style.display='grid';"><span class="auth-avatar-fallback" style="width:${size}px;height:${size}px;display:none;">${(user.displayName || 'U')[0].toUpperCase()}</span>`;
    }
    const initial = (user?.displayName || user?.email || 'U')[0].toUpperCase();
    return `<span class="auth-avatar-fallback" style="width:${size}px;height:${size}px;">${initial}</span>`;
  }

  function renderStartAuth(container) {
    if (!container) return;
    container.innerHTML = '';

    if (authState.user) {
      // Signed in user pill
      const pill = document.createElement('div');
      pill.className = 'auth-user-pill';
      pill.innerHTML = `
        <div class="auth-user-info">
          ${getAvatarHtml(authState.user, 32)}
          <div class="auth-user-names">
            <span class="auth-user-title">${authState.user.displayName || 'Signed in'}</span>
            <span class="auth-user-email">${authState.user.email}</span>
          </div>
        </div>
        <button type="button" class="auth-btn-secondary" id="auth-signout-btn" title="Sign out">Sign out</button>
      `;
      pill.querySelector('#auth-signout-btn').onclick = async (e) => {
        e.stopPropagation();
        await window.api.authSignOut();
      };
      container.appendChild(pill);
    } else {
      // Signed out: Show Google Sign-in button + setup icon
      const wrap = document.createElement('div');
      wrap.className = 'auth-guest-wrap';

      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'auth-btn-google';
      btn.innerHTML = `${G_SVG}<span>Continue with Google</span>`;
      btn.onclick = () => handleSignInClick();

      const cfgBtn = document.createElement('button');
      cfgBtn.type = 'button';
      cfgBtn.className = 'icon-btn auth-cfg-btn';
      cfgBtn.title = authState.isConfigured ? 'Firebase Settings' : 'Firebase not configured - click to set up';
      cfgBtn.innerHTML = `<svg class="ico" viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>`;
      if (!authState.isConfigured) {
        cfgBtn.classList.add('needs-setup');
      }
      cfgBtn.onclick = () => openConfigModal();

      wrap.appendChild(btn);
      wrap.appendChild(cfgBtn);
      container.appendChild(wrap);
    }
  }

  function renderSideAuth(container) {
    if (!container) return;
    container.innerHTML = '';

    if (authState.user) {
      container.innerHTML = `
        <div class="side-user-bar">
          ${getAvatarHtml(authState.user, 26)}
          <div class="side-user-names">
            <span class="side-user-name">${authState.user.displayName || 'Google User'}</span>
            <span class="side-user-sub">${authState.user.email}</span>
          </div>
          <button type="button" class="icon-btn side-user-logout" title="Sign out" aria-label="Sign out">
            <svg class="ico" viewBox="0 0 24 24"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>
          </button>
        </div>
      `;
      container.querySelector('.side-user-logout').onclick = async () => {
        await window.api.authSignOut();
      };
    } else {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'side-item side-login-btn';
      btn.innerHTML = `${G_SVG}<span>Sign in with Google</span>`;
      btn.onclick = () => handleSignInClick();
      container.appendChild(btn);
    }
  }

  async function handleSignInClick() {
    await refreshState();
    if (!authState.isConfigured) {
      openConfigModal('Please set up your Firebase project configuration first.');
      return;
    }

    const btn = document.querySelector('.auth-btn-google, .side-login-btn');
    if (btn) {
      btn.disabled = true;
      const span = btn.querySelector('span');
      if (span) span.textContent = 'Connecting...';
    }

    try {
      const res = await window.api.authSignIn();
      if (res?.error) {
        if (res.isIframe && confirm(res.error + '\n\nWould you like to open Vayun in your browser now?')) {
          window.open(location.href, '_blank');
        } else {
          alert(res.error);
        }
      }
    } catch (err) {
      console.error('Sign-in error', err);
      alert('Sign-in error: ' + (err.message || err));
    } finally {
      if (btn) {
        btn.disabled = false;
        const span = btn.querySelector('span');
        if (span) span.textContent = 'Continue with Google';
      }
    }
  }

  function openConfigModal(hintMessage = '') {
    let modal = document.getElementById('firebase-config-modal');
    if (!modal) {
      modal = document.createElement('div');
      modal.id = 'firebase-config-modal';
      modal.className = 'backdrop visible settings-backdrop';
      modal.innerHTML = `
        <div class="panel auth-modal-panel" role="dialog" aria-modal="true" aria-label="Firebase Configuration">
          <div class="auth-modal-head">
            <h3>Firebase Google Auth Setup</h3>
            <button type="button" class="icon-btn close-btn" aria-label="Close">✕</button>
          </div>
          <div class="auth-modal-body">
            <p class="muted small">
              Paste your Firebase configuration values below, or save them in <code>desktop/.env.local</code>.
            </p>
            <div id="auth-modal-hint" class="auth-modal-hint" ${hintMessage ? '' : 'hidden'}>${hintMessage}</div>
            <form id="firebase-cfg-form" class="auth-cfg-form">
              <label>API Key
                <input id="cfg-apiKey" type="text" placeholder="AIzaSy..." autocomplete="off">
              </label>
              <label>Auth Domain
                <input id="cfg-authDomain" type="text" placeholder="your-app.firebaseapp.com" autocomplete="off">
              </label>
              <label>Project ID
                <input id="cfg-projectId" type="text" placeholder="your-app" autocomplete="off">
              </label>
              <label>App ID
                <input id="cfg-appId" type="text" placeholder="1:123456789:web:abcdef" autocomplete="off">
              </label>
              <div class="auth-modal-actions">
                <button type="button" id="cfg-clear-btn" class="auth-btn-secondary">Clear</button>
                <button type="submit" class="primary">Save Configuration</button>
              </div>
            </form>
          </div>
        </div>
      `;
      document.body.appendChild(modal);

      modal.querySelector('.close-btn').onclick = () => { modal.classList.remove('visible'); };
      modal.onclick = (e) => { if (e.target === modal) modal.classList.remove('visible'); };

      modal.querySelector('#cfg-clear-btn').onclick = async () => {
        if (confirm('Clear saved Firebase configuration?')) {
          await window.api.authClearConfig();
          await refreshState();
          modal.classList.remove('visible');
        }
      };

      modal.querySelector('#firebase-cfg-form').onsubmit = async (e) => {
        e.preventDefault();
        const apiKey = document.getElementById('cfg-apiKey').value.trim();
        const authDomain = document.getElementById('cfg-authDomain').value.trim();
        const projectId = document.getElementById('cfg-projectId').value.trim();
        const appId = document.getElementById('cfg-appId').value.trim();

        if (!apiKey || !authDomain || !projectId || !appId) {
          alert('Please fill in API Key, Auth Domain, Project ID, and App ID.');
          return;
        }

        await window.api.authSetConfig({ apiKey, authDomain, projectId, appId });
        await refreshState();
        modal.classList.remove('visible');
      };
    }

    const hint = modal.querySelector('#auth-modal-hint');
    if (hint) {
      hint.textContent = hintMessage;
      hint.hidden = !hintMessage;
    }

    modal.classList.add('visible');
  }

  function renderAll() {
    renderStartAuth(document.getElementById('start-auth-mount'));
    renderSideAuth(document.getElementById('side-auth-mount'));
  }

  window.initAuthUI = function () {
    refreshState();
    if (window.api?.on) {
      window.api.on('auth:changed', (user) => {
        authState.user = user;
        renderAll();
      });
    }
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', window.initAuthUI);
  } else {
    window.initAuthUI();
  }
})();
