/*
 * Renders the Agentic Hub shell (ui.md 1.2-1.6) around a wireframe page.
 * A page only writes its own content; the frame, rail, banner and panel come from here.
 *
 * <body> attributes:
 *   data-area      Datasets | Agents | Knowledge | Sessions | Settings | Admin | (none)
 *   data-role      user | maker | admin   (admin shows the Admin rail item and every Settings section)
 *   data-mode      org | local            (local: avatar "D", no Admin item)
 *   data-initials  avatar initials in org mode
 *   data-sessions  JSON [[name, subtitle, current?], ...] for the drawer's Sessions list
 *   data-drawer    expanded (default) | collapsed
 *   data-settings  chosen Settings section when data-area="Settings"
 *   data-shell     none                   (no rail or canvas: the sign-in page)
 * Children of <body>:
 *   <main>                        page content (class "flush": no padding, for chat layouts)
 *   <aside data-panel="Title">    the details panel (data-width, default 572 as in ui.md 1.5)
 *   <div class="wf-overlay">      dialogs, menus, toasts and notes laid over the whole screen
 * Icons: <i data-lucide="bot" data-size="16"></i> becomes the lucide SVG (from icons.js).
 * Query string: ?notes=0 hides co-design notes; ?theme=dark switches the theme.
 */
(function () {
  const script = document.currentScript;
  const brand = new URL('../../../frontend/public/brand/agentic-hub/', script.src).href;
  const params = new URLSearchParams(location.search);
  if (params.get('notes') === '0') document.documentElement.classList.add('wf-hide-notes');
  if (params.get('theme')) document.documentElement.dataset.theme = params.get('theme');

  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  const ic = (name, size = 20) => `<i data-lucide="${name}" data-size="${size}"></i>`;

  function icons(root) {
    root.querySelectorAll('i[data-lucide]').forEach((el) => {
      const inner = (window.WF_ICONS || {})[el.dataset.lucide];
      const size = el.dataset.size || 16;
      const sw = el.dataset.stroke || 2;
      const svg = inner
        ? `<svg class="wf-icon" xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round" style="${el.getAttribute('style') || ''}">${inner}</svg>`
        : `<span title="missing icon ${esc(el.dataset.lucide)}" style="display:inline-block;width:${size}px;height:${size}px;border:1px dashed red"></span>`;
      el.outerHTML = svg;
    });
  }

  function rail(b) {
    const area = b.dataset.area || '';
    const role = b.dataset.role || 'user';
    const local = b.dataset.mode === 'local';
    const nav = (label, icon, color = 'var(--qti-accent)') =>
      `<div class="wf-nav${area === label ? ' current' : ''}"><span style="color:${color};display:flex">${ic(icon)}</span><span class="wf-nav-label">${label}</span></div>`;
    let sessions = [];
    try { sessions = JSON.parse(b.dataset.sessions || '[]'); } catch (e) { /* keep empty */ }
    const list = sessions.length
      ? sessions.map(([n, s, cur]) => `<div class="wf-session${cur ? ' current' : ''}"><b>${esc(n)}</b><small>${esc(s || '')}</small></div>`).join('')
      : '<div class="small muted" style="padding:0 14px">No sessions yet.</div>';
    return `<aside class="wf-rail${b.dataset.drawer === 'collapsed' ? ' collapsed' : ''}" aria-label="Navigation rail">
      <div class="wf-nav" style="color:var(--qti-icon)">${ic('menu', 24)}</div>
      <div class="wf-logo"><span class="wf-logo-mark"><img src="${brand}logo-mark.svg" width="7" height="21" alt=""></span><span class="wf-nav-label">Agentic Hub</span></div>
      ${nav('Datasets', 'flask-conical')}${nav('Agents', 'bot')}${nav('Knowledge', 'book-open')}${nav('Sessions', 'folder-kanban')}
      <div class="wf-divider"></div>
      <div class="wf-sessions"><div class="wf-sessions-head"><span>Sessions</span><span style="color:var(--qti-fg-muted);display:flex">${ic('plus', 16)}</span></div>${list}</div>
      <div style="flex:1"></div>
      ${role === 'admin' && !local ? nav('Admin', 'shield', 'var(--qti-icon)') : ''}
      <div style="padding:8px 8px"><span class="wf-avatar" title="${local ? 'Demo User' : 'Account menu'}">${local ? 'D' : esc(b.dataset.initials || 'JB')}</span></div>
      ${nav('System logs', 'scroll-text', 'var(--qti-icon)')}${nav('Settings', 'settings', 'var(--qti-icon)')}
      <div class="wf-divider"></div>
      <div class="wf-powered"><img src="${brand}lenai-mark.svg" width="28" alt=""><br><img src="${brand}powered-by-lenai.svg" width="56" alt="Powered by LenAI"></div>
    </aside>`;
  }

  function settingsPane(b) {
    const admin = (b.dataset.role || 'user') === 'admin';
    const items = [
      ['Datasource Configuration', 'database', admin],
      ['LLM Configuration', 'bot', admin],
      ['Testing Data', 'test-tube', admin],
      ['Developer', 'wrench', admin],
      ['Appearance', 'sun-moon', true],
    ].filter((i) => i[2]);
    return `<div style="width:260px;flex:none;border-right:1px solid var(--qti-border);padding:20px 16px;display:flex;flex-direction:column;gap:12px">
      <div class="field row" style="padding:8px 10px">${ic('search', 16)}<span class="grow" style="color:var(--qti-placeholder)">Search settings</span><span class="small muted">⌘ F</span></div>
      ${items.map(([l, i]) => `<div class="list-row row g12 ${b.dataset.settings === l ? 'list-row-selected' : ''}" style="padding:10px 12px">${ic(i, 16)}<span>${l}</span></div>`).join('')}
      <div style="flex:1"></div><div class="small muted">Agentic Hub<br>v0.29.0</div></div>`;
  }

  function build() {
    const b = document.body;
    const main = b.querySelector(':scope > main');
    const panel = b.querySelector(':scope > aside[data-panel]');
    const overlays = [...b.querySelectorAll(':scope > .wf-overlay')];
    const screen = document.createElement('div');
    screen.className = 'wf-screen';
    screen.style.setProperty('--wf-brand', `url("${brand}frame-texture.webp")`);
    if (b.dataset.shell === 'none') {
      screen.innerHTML = '<div style="position:relative;z-index:1;flex:1;display:grid;place-items:center"></div>';
      if (main) screen.firstChild.appendChild(main);
    } else {
      screen.innerHTML = `${rail(b)}<div class="wf-canvas"><header class="wf-banner" role="banner"><h1>Agentic Hub</h1></header><div class="wf-body"><section class="wf-page card"></section></div></div>`;
      const page = screen.querySelector('.wf-page');
      if (b.dataset.area === 'Settings') { page.style.flexDirection = 'row'; page.insertAdjacentHTML('beforeend', settingsPane(b)); }
      if (main) {
        if (!main.classList.contains('flush')) main.classList.add('wf-page-content');
        else main.style.cssText += ';flex:1;min-height:0;display:flex;flex-direction:column;overflow:hidden';
        page.appendChild(main);
      }
      if (panel) {
        const p = document.createElement('aside');
        p.className = 'wf-panel card';
        if (panel.dataset.width) p.style.width = panel.dataset.width + 'px';
        const title = panel.dataset.panel;
        p.innerHTML = `<div class="wf-panel-head">${title ? `<span class="micro">${esc(title)}</span>` : ''}<span class="grow"></span><span style="color:var(--qti-fg-muted);display:flex">${ic('panel-right', 16)}</span></div><div class="wf-panel-body"></div>`;
        while (panel.firstChild) p.lastChild.appendChild(panel.firstChild);
        panel.remove();
        screen.querySelector('.wf-body').appendChild(p);
      } else if (b.dataset.area !== 'Sessions') {
        // The Sessions area has its own Expand button in the page header (ui.md 1.2).
        page.insertAdjacentHTML('beforeend', `<span style="position:absolute;top:8px;right:8px;color:var(--qti-fg-muted);display:flex" title="Expand right panel">${ic('panel-right', 16)}</span>`);
      }
    }
    overlays.forEach((o) => { o.classList.add('wf-overlay-placed'); screen.appendChild(o); });
    b.prepend(screen);
    icons(document);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', build);
  else build();
})();
