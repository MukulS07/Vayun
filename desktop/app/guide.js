// First-run guide: a short tour that points at the real buttons (spotlight + card). It starts by itself in a brand new
// workspace and can be run again from the sidebar or the search palette ("Take the tour"). It also writes a
// "Getting started" page, which the tour then shows as a mind map. Text is only ever set as textContent.
(function () {
  const GUIDE_PAGE = 'guide-page';
  const GUIDE_BLOCKS = [
    { type: 'text', text: 'This page is a small tour in itself. Press Mindmap above to see it as a map: every heading is a branch.' },
    { type: 'h1', text: 'Write and organise' },
    { type: 'bullet', text: 'Type / for headings, lists and to-dos' },
    { type: 'bullet', text: 'Start a line with "# ", "- " or "[] " for a shortcut' },
    { type: 'bullet', text: 'Add a subpage from the ••• menu to nest pages' },
    { type: 'h1', text: 'Find things fast' },
    { type: 'bullet', text: 'Ctrl K searches every page' },
    { type: 'bullet', text: 'Star a page to keep it in Favorites' },
    { type: 'bullet', text: 'Pin a page to Home' },
    { type: 'h1', text: 'Plan your days' },
    { type: 'bullet', text: 'Calendar shows your events and due dates' },
    { type: 'bullet', text: 'A tasks database becomes a board: To do, Doing, Done' },
    { type: 'bullet', text: 'Team shares tasks with the people you work with' },
    { type: 'h1', text: 'Ask the Assistant' },
    { type: 'bullet', text: 'Ctrl J opens it' },
    { type: 'bullet', text: 'Ask it to write, plan or set things up, then Undo if you do not like it' },
    { type: 'h1', text: 'Bring your work in' },
    { type: 'bullet', text: 'Notion export, HTML or PDF files' },
    { type: 'bullet', text: 'Google Form responses become a task board' },
  ];

  // Each step: where to point (selector), what to say, and optionally something to do first.
  const STEPS = [
    { title: 'Welcome to Vayun', body: 'Notes, tasks, a calendar and your team in one calm place, stored on this PC. This one-minute tour shows where things are. You can leave it any time with Esc.' },
    { target: '#home-btn', title: 'Home', body: 'Your starting screen: what is due today, reminders and the pages you pinned.' },
    { target: '#tree', title: 'Your pages', body: 'Everything you write lives here. Pages with subpages fold up with the small arrow, so long lists stay short.' },
    { target: '#new-btn', title: 'Start something new', body: 'Add a page, begin from a template such as Life OS or Study OS, or make a tasks database.' },
    { target: '#search-btn', title: 'Search', body: 'Press Ctrl K to jump to any page or run a command, like changing the theme.' },
    { target: '#ai-btn', title: 'Assistant', body: 'Press Ctrl J and say what you need: write into the page, plan your week, set up a planner. Every change has an Undo.' },
    { target: '#cal-btn', title: 'Calendar and Team', body: 'The calendar gathers events and due dates. Team lets you share tasks and see who is doing what.' },
    { target: '#import-btn', title: 'Bring your work in', body: 'Import a Notion export, HTML or PDF files, or the responses of a Google Form, which become a task board.' },
    { target: '#mm-btn', title: 'Turn a page into a mind map', body: 'This is the Getting started page. Press Mindmap to see it as a map.', before: ctx => ctx.openGuide('doc'), place: 'bottom' },
    { target: '.mm-view', title: 'Your page as a map', body: 'Headings become branches and their lines hang off them. Drag to move, scroll to zoom, double-click a branch to jump to that text, press Tab to add a branch.', before: ctx => ctx.openGuide('mindmap'), place: 'center-card' },
    { target: '#theme-btn', title: 'Make it yours', body: 'Pick a theme, accent colour and text size.', before: ctx => ctx.home() },
    { title: 'You are ready', body: 'Ctrl N makes a new page, Ctrl K searches, Ctrl J asks the Assistant. To see this tour again, press "Take the tour" at the bottom of the sidebar.' },
  ];

  let overlay = null, step = 0, ctx = null;

  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };

  // A brand new workspace has only the seeded Welcome page (and Home, which opens by itself).
  const isNewWorkspace = d => d.pages.every(p => p.kind === 'home' || p.id === 'welcome');

  function guidePage() {
    let p = data.pages.find(x => x.id === GUIDE_PAGE);
    if (!p) {
      p = { id: GUIDE_PAGE, title: 'Getting started with Vayun', parentId: null, blocks: GUIDE_BLOCKS.map(b => ({ id: uid(), ...b })) };
      data.pages.push(p);
      save();
    }
    return p;
  }

  function visibleRect(selector) {
    const t = selector && document.querySelector(selector);
    if (!t) return null;
    const r = t.getBoundingClientRect();
    return r.width > 0 && r.height > 0 ? r : null;
  }

  function finish() {
    document.removeEventListener('keydown', onKey, true);
    window.removeEventListener('resize', draw);
    if (overlay) overlay.remove();
    overlay = null;
    data.guideDone = true;
    save();
    if (ctx && ctx.leftHome === false) ctx.home();
    document.querySelector('#tour-btn')?.focus();
  }

  function go(n) {
    if (n < 0) return;
    if (n >= STEPS.length) return finish();
    step = n;
    const s = STEPS[step];
    if (s.before) s.before(ctx);
    requestAnimationFrame(draw); // let the page the step needs render first
  }

  function draw() {
    if (!overlay) return;
    const s = STEPS[step];
    const rect = visibleRect(s.target);
    overlay.innerHTML = '';
    const hole = el('div', 'guide-hole');
    if (rect) {
      Object.assign(hole.style, { left: `${rect.left - 6}px`, top: `${rect.top - 6}px`, width: `${rect.width + 12}px`, height: `${rect.height + 12}px` });
    } else hole.classList.add('none');
    const card = el('div', 'guide-card');
    card.setAttribute('role', 'dialog');
    card.setAttribute('aria-modal', 'true');
    card.setAttribute('aria-label', 'Vayun tour');
    card.append(el('div', 'guide-step', `${step + 1} of ${STEPS.length}`), el('h3', 'guide-title', s.title), el('p', 'guide-body', s.body));
    const bar = el('div', 'guide-bar');
    const skip = el('button', 'guide-skip', step === STEPS.length - 1 ? '' : 'Skip');
    skip.type = 'button';
    skip.hidden = step === STEPS.length - 1;
    skip.onclick = finish;
    const back = el('button', 'guide-back', 'Back');
    back.type = 'button';
    back.disabled = step === 0;
    back.onclick = () => go(step - 1);
    const next = el('button', 'guide-next', step === STEPS.length - 1 ? 'Done' : step === 0 ? 'Take the tour' : 'Next');
    next.type = 'button';
    next.onclick = () => go(step + 1);
    bar.append(skip, back, next);
    card.append(bar);
    overlay.append(hole, card);
    // place the card beside what it points at, inside the window; centred when there is nothing to point at
    const cw = 340, gap = 16, vw = innerWidth, vh = innerHeight;
    const ch = card.offsetHeight || 190;
    let left = (vw - cw) / 2, top = (vh - ch) / 2;
    if (rect && s.place !== 'center-card') {
      if (s.place === 'bottom') { left = rect.left; top = rect.bottom + gap; }
      else { left = rect.right + gap; top = rect.top - 8; }
      if (left + cw > vw - 12) left = Math.max(12, rect.left - cw - gap);
      if (left + cw > vw - 12) left = (vw - cw) / 2;
      top = Math.max(12, Math.min(top, vh - ch - 12));
      if (s.place === 'bottom' && top < rect.bottom) top = rect.bottom + gap;
    } else if (rect) { left = vw - cw - 24; top = vh - ch - 24; }
    card.style.left = `${Math.max(12, left)}px`;
    card.style.top = `${Math.max(12, top)}px`;
    next.focus();
  }

  function onKey(e) {
    if (!overlay) return;
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); finish(); }
    else if (e.key === 'ArrowRight') { e.preventDefault(); e.stopPropagation(); go(step + 1); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); e.stopPropagation(); go(step - 1); }
    else if (e.key === 'Tab') { // keep focus inside the card
      const items = [...overlay.querySelectorAll('button:not([disabled]):not([hidden])')];
      if (!items.length) return;
      const i = items.indexOf(document.activeElement);
      e.preventDefault();
      items[(i + (e.shiftKey ? items.length - 1 : 1)) % items.length].focus();
    }
  }

  function start() {
    if (overlay) return;
    ctx = {
      leftHome: true,
      openGuide(view) { const p = guidePage(); ctx.leftHome = false; openPage(p.id, view); },
      home() { openHome(); ctx.leftHome = true; },
    };
    overlay = el('div', 'guide');
    document.body.append(overlay);
    document.addEventListener('keydown', onKey, true);
    window.addEventListener('resize', draw);
    step = 0;
    draw();
  }

  // Runs once, in a brand new workspace. Anyone with pages already is not interrupted, and is not asked again.
  function maybeStart() {
    if (data.guideDone) return;
    if (isNewWorkspace(data)) start();
    else { data.guideDone = true; save(); }
  }

  window.FolioGuide = { start, maybeStart, isNewWorkspace, STEPS, GUIDE_BLOCKS };
})();
