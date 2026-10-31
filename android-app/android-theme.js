// Vayun Mobile - Phase 3 Theme Sync, Drawer Navigation, Haptics & Native Share Controller
(function () {
  document.addEventListener('DOMContentLoaded', () => {
    // 0. Branded Vayun Loading Screen Lifecycle
    const loadingScreen = document.getElementById('vayun-loading-screen');
    const loadingCaption = document.getElementById('loading-caption');

    const dismissLoadingScreen = (delay = 400) => {
      if (!loadingScreen) return;
      setTimeout(() => {
        loadingScreen.classList.add('fade-out');
        setTimeout(() => {
          loadingScreen.style.display = 'none';
        }, 400);
      }, delay);
    };

    const showLoadingScreen = (msg = 'Loading…') => {
      if (!loadingScreen) return;
      if (loadingCaption) loadingCaption.textContent = msg;
      loadingScreen.style.display = 'flex';
      void loadingScreen.offsetWidth;
      loadingScreen.classList.remove('fade-out');
    };

    window.dismissLoadingScreen = dismissLoadingScreen;
    window.showLoadingScreen = showLoadingScreen;

    if (loadingScreen) {
      if (document.querySelector('.start')) {
        const wsGrid = document.getElementById('ws-grid');
        const enhanceCards = () => {
          document.querySelectorAll('.ws-card-go').forEach(go => {
            if (!go.querySelector('svg')) {
              go.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18l6-6-6-6"/></svg>`;
            }
          });
        };

        if (wsGrid) {
          const obs = new MutationObserver(() => {
            if (wsGrid.children.length > 0) {
              obs.disconnect();
              enhanceCards();
              dismissLoadingScreen(350);
            }
          });
          obs.observe(wsGrid, { childList: true });
          setTimeout(enhanceCards, 200);
        }
        setTimeout(() => dismissLoadingScreen(100), 700);

        document.addEventListener('click', e => {
          const card = e.target.closest('.ws-card');
          if (card) {
            showLoadingScreen('Opening workspace…');
          }
        });
      } else {
        setTimeout(() => dismissLoadingScreen(150), 500);
      }
    }

    const isMobile = () => window.innerWidth <= 768;
    const sidebar = document.querySelector('.side, .sidebar');
    const appEl = document.querySelector('.app') || document.body;

    // 1. Ensure Backdrop is placed correctly inside .app BEFORE .side
    let backdrop = document.querySelector('.sidebar-backdrop');
    if (!backdrop) {
      backdrop = document.createElement('div');
      backdrop.className = 'sidebar-backdrop';
      if (sidebar && sidebar.parentNode) {
        sidebar.parentNode.insertBefore(backdrop, sidebar);
      } else {
        appEl.appendChild(backdrop);
      }
    }

    const openDrawer = () => {
      if (!sidebar) return;
      sidebar.classList.add('mobile-open');
      backdrop.classList.add('active');
      if (window.__vayunAndroid?.haptic) window.__vayunAndroid.haptic();
    };

    const closeDrawer = () => {
      if (!sidebar) return;
      sidebar.classList.remove('mobile-open');
      backdrop.classList.remove('active');
    };

    const toggleDrawer = () => {
      if (!sidebar) return;
      const isOpen = sidebar.classList.contains('mobile-open');
      if (isOpen) closeDrawer();
      else openDrawer();
    };

    backdrop.addEventListener('click', closeDrawer);

    // 2. Add Hamburger Button to Topbar
    const header = document.querySelector('.topbar, header.app-header, .titlebar');
    if (header && !header.querySelector('.mobile-menu-trigger')) {
      const menuBtn = document.createElement('button');
      menuBtn.className = 'mobile-menu-trigger';
      menuBtn.setAttribute('aria-label', 'Toggle Navigation Drawer');
      menuBtn.setAttribute('type', 'button');
      menuBtn.innerHTML = `
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
          <line x1="3" y1="12" x2="21" y2="12"></line>
          <line x1="3" y1="6" x2="21" y2="6"></line>
          <line x1="3" y1="18" x2="21" y2="18"></line>
        </svg>
      `;
      menuBtn.addEventListener('click', e => {
        e.preventDefault();
        e.stopPropagation();
        toggleDrawer();
      });
      header.prepend(menuBtn);
    }

    // 3. Close drawer on navigation item selection
    if (sidebar) {
      sidebar.addEventListener('click', e => {
        const item = e.target.closest('.side-item, #tree a, .ws, #theme-btn, .mobile-backup-item');
        if (item) {
          if (item.id === 'theme-btn' || item.classList.contains('mobile-backup-item')) return;
          if (isMobile()) {
            setTimeout(closeDrawer, 180);
          }
        }
      });
    }

    // 4. Touch Gestures: Edge Swipe to Open & Swipe to Close
    let touchStartX = 0;
    let touchStartY = 0;
    document.addEventListener('touchstart', e => {
      touchStartX = e.touches[0].clientX;
      touchStartY = e.touches[0].clientY;
    }, { passive: true });

    document.addEventListener('touchend', e => {
      const touchEndX = e.changedTouches[0].clientX;
      const touchEndY = e.changedTouches[0].clientY;
      const diffX = touchEndX - touchStartX;
      const diffY = Math.abs(touchEndY - touchStartY);

      if (diffY < 60) {
        if (touchStartX < 40 && diffX > 50) {
          openDrawer();
        } else if (diffX < -50 && sidebar && sidebar.classList.contains('mobile-open')) {
          closeDrawer();
        }
      }
    }, { passive: true });

    // 5. Mobile Bottom Navigation Bar (Elevated Center FAB)
    const isAppScreen = document.querySelector('.app') !== null;
    if (isAppScreen && !document.querySelector('.mobile-bottom-bar')) {
      const bottomBar = document.createElement('nav');
      bottomBar.className = 'mobile-bottom-bar';
      bottomBar.setAttribute('aria-label', 'Mobile Navigation');

      bottomBar.innerHTML = `
        <button class="mobile-tab-btn active" data-target="home" aria-label="Home" type="button">
          <svg viewBox="0 0 24 24"><path d="M3 11l9-7 9 7 M5 10v10h14V10 M10 20v-6h4v6" stroke-linecap="round" stroke-linejoin="round"/></svg>
          <span>Home</span>
        </button>
        <button class="mobile-tab-btn" data-target="calendar" aria-label="Calendar" type="button">
          <svg viewBox="0 0 24 24"><path d="M4 5h16v15H4z M4 9h16 M8 3v4 M16 3v4" stroke-linecap="round" stroke-linejoin="round"/></svg>
          <span>Calendar</span>
        </button>
        <button class="mobile-tab-btn fab-item" data-target="new" aria-label="New Note" type="button">
          <div class="fab-circle">
            <svg viewBox="0 0 24 24"><path d="M12 5v14 M5 12h14" stroke-linecap="round"/></svg>
          </div>
          <span>New</span>
        </button>
        <button class="mobile-tab-btn" data-target="search" aria-label="Search" type="button">
          <svg viewBox="0 0 24 24"><path d="M11 4a7 7 0 1 0 0 14a7 7 0 1 0 0-14z M20 20l-4-4" stroke-linecap="round"/></svg>
          <span>Search</span>
        </button>
        <button class="mobile-tab-btn" data-target="pages" aria-label="Pages / Sidebar" type="button">
          <svg viewBox="0 0 24 24"><path d="M4 6h16 M4 12h10 M4 18h14" stroke-linecap="round" stroke-linejoin="round"/></svg>
          <span>Pages</span>
        </button>
      `;

      document.body.appendChild(bottomBar);

      bottomBar.addEventListener('click', e => {
        const btn = e.target.closest('.mobile-tab-btn');
        if (!btn) return;
        const target = btn.dataset.target;

        if (window.__vayunAndroid?.haptic) window.__vayunAndroid.haptic();

        // Dismiss any open modals or search when switching tabs
        if (target !== 'search') {
          const searchBackdrop = document.querySelector('#backdrop');
          if (searchBackdrop) searchBackdrop.classList.remove('visible');
          document.querySelectorAll('.backdrop.visible:not(#backdrop)').forEach(b => {
            const closeBtn = b.querySelector('.cal-actions button:last-child, button[data-action="close"]');
            if (closeBtn) closeBtn.click();
            else b.remove();
          });
        }

        if (target === 'home') {
          bottomBar.querySelectorAll('.mobile-tab-btn').forEach(b => b.classList.remove('active'));
          btn.classList.add('active');
          const homeBtn = document.querySelector('#home-btn');
          if (homeBtn) homeBtn.click();
        } else if (target === 'calendar') {
          bottomBar.querySelectorAll('.mobile-tab-btn').forEach(b => b.classList.remove('active'));
          btn.classList.add('active');
          const calBtn = document.querySelector('#cal-btn');
          if (calBtn) calBtn.click();
        } else if (target === 'new') {
          bottomBar.querySelectorAll('.mobile-tab-btn').forEach(b => b.classList.remove('active'));
          const newBtn = document.querySelector('#new-btn');
          if (newBtn) newBtn.click();
        } else if (target === 'search') {
          const searchBtn = document.querySelector('#search-btn');
          if (searchBtn) searchBtn.click();
        } else if (target === 'pages') {
          toggleDrawer();
        }
      });

      document.addEventListener('focusin', e => {
        if (e.target.matches('input, textarea, [contenteditable="true"], [contenteditable="plaintext-only"]')) {
          bottomBar.style.display = 'none';
          document.body.classList.add('keyboard-open');
        }
      });
      document.addEventListener('focusout', () => {
        bottomBar.style.display = 'flex';
        document.body.classList.remove('keyboard-open');
      });
    }

    // In-app Material 3 feedback snackbar
    function showMobileSnackbar(message) {
      if (window.VayunAndroid && typeof window.VayunAndroid.showToast === 'function') {
        window.VayunAndroid.showToast(message);
        return;
      }
      let snackbar = document.getElementById('mobile-snackbar');
      if (!snackbar) {
        snackbar = document.createElement('div');
        snackbar.id = 'mobile-snackbar';
        snackbar.className = 'mobile-snackbar';
        snackbar.setAttribute('role', 'status');
        snackbar.setAttribute('aria-live', 'polite');
        document.body.appendChild(snackbar);
      }
      snackbar.textContent = message;
      snackbar.classList.add('visible');
      clearTimeout(snackbar._timer);
      snackbar._timer = setTimeout(() => {
        snackbar.classList.remove('visible');
      }, 3200);
    }
    window.showMobileSnackbar = showMobileSnackbar;

    // 6. Global Modal Tap-Outside to Dismiss
    document.addEventListener('click', e => {
      const backdrop = e.target;
      if (backdrop && backdrop.classList && backdrop.classList.contains('backdrop') && backdrop.classList.contains('visible')) {
        const closeBtn = backdrop.querySelector('.mobile-search-close-btn, .cal-actions button:last-child, button[data-action="close"]');
        if (closeBtn) closeBtn.click();
        else backdrop.classList.remove('visible');
      }
    });

    // 7. Continuous Theme Sync to Android Status & Navigation Bar
    const syncThemeToSystem = () => {
      const computedBg = getComputedStyle(document.documentElement).getPropertyValue('--bg').trim() || '#161616';
      const isDark = document.documentElement.getAttribute('data-theme') !== 'light';
      if (window.api && typeof window.api.setTitleBar === 'function') {
        window.api.setTitleBar(computedBg, isDark ? '#ECECEA' : '#1C1B19');
      }
    };

    const observer = new MutationObserver(syncThemeToSystem);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'data-template'] });
    syncThemeToSystem();

    // 8. Update Storage Note on Mobile (Replace Desktop Copy)
    const updateStorageNotes = () => {
      document.querySelectorAll('.ws-storage-note, p.muted').forEach(note => {
        if (note.textContent.includes('PC') || note.textContent.includes('this PC')) {
          note.textContent = note.textContent.replace(/this PC/g, 'this device (100% private & offline)');
        }
      });
    };
    updateStorageNotes();

    // 9. Wire Native Share Button in Topbar
    const shareBtn = document.getElementById('share-btn');
    if (shareBtn) {
      shareBtn.disabled = false;
      shareBtn.removeAttribute('disabled');
      shareBtn.setAttribute('title', 'Share note via Android');
      shareBtn.addEventListener('click', e => {
        e.preventDefault();
        e.stopPropagation();
        if (window.__vayunAndroid?.haptic) window.__vayunAndroid.haptic();
        if (window.api && typeof window.api.shareCurrentNote === 'function') {
          window.api.shareCurrentNote();
        }
      });
    }

    // 10. Global Haptic Pulses on Task Checks, Done buttons, and Swatches
    document.addEventListener('change', e => {
      if (e.target && e.target.matches('input[type="checkbox"]')) {
        if (window.__vayunAndroid?.haptic) window.__vayunAndroid.haptic();
      }
    });

    document.addEventListener('click', e => {
      const el = e.target.closest('.home-done, .cal-swatch, .cal-cell, .fab-circle, #star-btn, #theme-btn, .cal-seg button');
      if (el) {
        if (window.__vayunAndroid?.haptic) window.__vayunAndroid.haptic();
      }
    });

    // 11. Add Offline Backup Option in Sidebar
    if (sidebar && !document.getElementById('mobile-backup-btn')) {
      const backupBtn = document.createElement('button');
      backupBtn.id = 'mobile-backup-btn';
      backupBtn.type = 'button';
      backupBtn.className = 'side-item mobile-backup-item';
      backupBtn.innerHTML = `
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-right:8px;vertical-align:-2px;">
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
          <polyline points="7 10 12 15 17 10"></polyline>
          <line x1="12" y1="15" x2="12" y2="3"></line>
        </svg>
        <span>Backup Workspace (JSON)</span>
      `;
      backupBtn.addEventListener('click', async () => {
        if (window.__vayunAndroid?.haptic) window.__vayunAndroid.haptic();
        if (window.api && typeof window.api.exportWorkspaceBackup === 'function') {
          const res = await window.api.exportWorkspaceBackup();
          if (res) showMobileSnackbar(`Workspace backup exported: ${res}`);
        }
      });
      sidebar.appendChild(backupBtn);
    }

    // 12. Start Page Empty State, Loading State, and Accessibility
    const wsGrid = document.getElementById('ws-grid');
    const newForm = document.getElementById('new-form');
    if (wsGrid && newForm) {
      const checkEmptyState = () => {
        const cards = wsGrid.querySelectorAll('.ws-card');
        let emptyState = document.getElementById('ws-empty-state');
        if (cards.length === 0) {
          if (!emptyState) {
            emptyState = document.createElement('div');
            emptyState.id = 'ws-empty-state';
            emptyState.className = 'ws-empty';
            emptyState.innerHTML = `
              <div class="ws-empty-icon" aria-hidden="true">🍃</div>
              <div class="ws-empty-title">No workspaces yet</div>
              <div class="ws-empty-desc">Create your first private offline workspace below to begin taking notes and managing tasks.</div>
            `;
            wsGrid.appendChild(emptyState);
          }
        } else if (emptyState) {
          emptyState.remove();
        }
      };

      const gridObserver = new MutationObserver(checkEmptyState);
      gridObserver.observe(wsGrid, { childList: true });
      setTimeout(checkEmptyState, 250);

      newForm.addEventListener('submit', () => {
        const btn = newForm.querySelector('button[type="submit"]');
        if (btn) {
          btn.disabled = true;
          const orig = btn.textContent;
          btn.textContent = 'Creating workspace…';
          if (typeof showLoadingScreen === 'function') {
            showLoadingScreen('Creating workspace…');
          }
          setTimeout(() => {
            btn.disabled = false;
            btn.textContent = orig;
            if (typeof dismissLoadingScreen === 'function') {
              dismissLoadingScreen(0);
            }
          }, 4000);
        }
      });
    }
  });
})();


// Signing out returns to the first-run welcome (Get started, then Sign in or Continue as guest).
(function () {
  var api = window.api;
  if (!api || typeof api.authSignOut !== 'function' || api.__welcomeOnSignOut) return;
  var original = api.authSignOut.bind(api);
  api.authSignOut = async function () {
    var result = await original.apply(null, arguments);
    if (result && result.error) return result;
    try { localStorage.removeItem('vayun:welcomeSeen'); } catch (e) { /* private mode: the welcome just shows next time */ }
    location.replace('welcome.html');
    return result;
  };
  api.__welcomeOnSignOut = true;
})();
