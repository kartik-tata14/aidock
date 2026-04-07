(() => {
  'use strict';

  let currentUser = null;
  let tools = [];

  const $ = (s) => document.querySelector(s);
  const modalOverlay   = $('#modalOverlay');
  const deleteOverlay  = $('#deleteOverlay');
  const toolForm       = $('#toolForm');
  const cardsGrid      = $('#cardsGrid');
  const emptyState     = $('#emptyState');
  const searchInput    = $('#searchInput');
  const categoryFiltersEl = $('#categoryFilters');
  const pricingFiltersEl  = $('#pricingFilters');

  let activeCategory = 'All';
  let activePricing  = 'All';
  let searchQuery    = '';
  let deleteTargetId = null;

  /* ===== Router ===== */
  const router = {
    // Navigate to a new path (pushes to history)
    navigate(path, replace = false) {
      if (window.location.pathname === path) return;
      if (replace) {
        history.replaceState(null, '', path);
      } else {
        history.pushState(null, '', path);
      }
      this.handleRoute();
    },
    
    // Parse current path and return route info
    parseRoute() {
      const path = window.location.pathname;
      // /dashboard/social/friend/:id
      const friendMatch = path.match(/^\/dashboard\/social\/friend\/(\d+)$/);
      if (friendMatch) {
        return { view: 'social', page: 'friend', friendId: parseInt(friendMatch[1], 10) };
      }
      // /dashboard/social
      if (path === '/dashboard/social' || path === '/dashboard/social/') {
        return { view: 'social', page: 'list' };
      }
      // /dashboard (default)
      return { view: 'my', page: 'list' };
    },
    
    // Handle current route
    async handleRoute() {
      const route = this.parseRoute();
      const viewToggle = document.getElementById('viewToggle');
      const myViewEl = document.getElementById('dashboard');
      const socialViewEl = document.getElementById('socialView');
      const friendProfileOverlay = document.getElementById('friendProfileOverlay');
      const sidebarMyView = document.getElementById('sidebarMyView');
      const sidebarSocialView = document.getElementById('sidebarSocialView');
      
      if (!viewToggle || !myViewEl || !socialViewEl) return; // Elements not ready
      
      // Update toggle button state
      viewToggle.querySelectorAll('.view-toggle-btn').forEach(b => {
        b.classList.toggle('active', b.dataset.view === route.view);
      });
      viewToggle.classList.toggle('social-active', route.view === 'social');
      currentView = route.view;
      
      if (route.view === 'my') {
        document.title = 'Dashboard — AIDock';
        myViewEl.style.display = '';
        socialViewEl.style.display = 'none';
        friendProfileOverlay.style.display = 'none';
        if (sidebarMyView) sidebarMyView.style.display = '';
        if (sidebarSocialView) sidebarSocialView.style.display = 'none';
      } else {
        document.title = route.page === 'friend' ? 'Friend Profile — AIDock' : 'Social — AIDock';
        myViewEl.style.display = 'none';
        socialViewEl.style.display = '';
        if (sidebarMyView) sidebarMyView.style.display = 'none';
        if (sidebarSocialView) sidebarSocialView.style.display = '';
        
        // Load friends if not cached
        if (typeof loadFriends === 'function') {
          await loadFriends();
        }
        
        // Handle friend profile page
        if (route.page === 'friend' && route.friendId) {
          await openFriendProfileById(route.friendId);
        } else {
          // Reset friend profile tabs when leaving
          if (friendProfileOverlay && friendProfileOverlay.style.display !== 'none') {
            friendProfileOverlay.querySelectorAll('.friend-tab').forEach(t => t.classList.remove('active'));
            const toolsTabBtn = friendProfileOverlay.querySelector('.friend-tab[data-tab="tools"]');
            if (toolsTabBtn) toolsTabBtn.classList.add('active');
            const friendToolsTab = document.getElementById('friendToolsTab');
            const friendStacksTab = document.getElementById('friendStacksTab');
            if (friendToolsTab) friendToolsTab.style.display = '';
            if (friendStacksTab) friendStacksTab.style.display = 'none';
          }
          friendProfileOverlay.style.display = 'none';
        }
      }
    }
  };
  
  // Listen for back/forward navigation
  window.addEventListener('popstate', () => router.handleRoute());

  /* ===== API helpers ===== */
  async function api(url, opts = {}) {
    opts.headers = { 'Content-Type': 'application/json', ...opts.headers };
    const res = await fetch(url, opts);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Request failed');
    return data;
  }

  /* ===== Theme ===== */
  function initTheme() {
    const saved = localStorage.getItem('aidock-theme');
    const prefer = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    document.documentElement.setAttribute('data-theme', saved || prefer);
  }
  initTheme();
  const themeBtn = document.getElementById('themeToggle');
  if (themeBtn) themeBtn.addEventListener('click', () => {
    const next = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    localStorage.setItem('aidock-theme', next);
  });

  /* ===== Auth check ===== */
  async function init() {
    try {
      const data = await api('/api/auth/me');
      currentUser = data.user;
    } catch {
      window.location.href = '/auth';
      return;
    }
    updateAvatar();
    await loadTools();
    try { await loadStacks(); } catch (e) { console.warn('Stacks load failed:', e); }
    render();
    // Initialize router after UI is ready
    router.handleRoute();
    
    // Check for showPaywall parameter (from extension limit reached)
    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.get('showPaywall') === '1') {
      // Clean up URL
      history.replaceState({}, '', window.location.pathname);
      // Show limit paywall after a brief delay (uses existing dashboard paywall)
      setTimeout(() => openLimitPaywall(), 300);
    }
  }

  async function loadTools() {
    const data = await api('/api/tools');
    tools = data.tools;
  }

  /* ===== Greeting & Avatar ===== */
  function getTimeGreeting() {
    const h = new Date().getHours();
    if (h < 12) return { text: 'Good Morning', emoji: '☀️' };
    if (h < 17) return { text: 'Good Afternoon', emoji: '🌤️' };
    if (h < 21) return { text: 'Good Evening', emoji: '🌇' };
    return { text: 'Good Night', emoji: '🌙' };
  }

  function updateGreeting() {
    if (!currentUser) return;
    const { text, emoji } = getTimeGreeting();
    const greetEl = $('#greetingText');
    const subEl = $('#greetingSub');
    if (greetEl) greetEl.innerHTML = `${text}, ${esc(currentUser.name)} <span class="wave">${emoji}</span>`;
    if (subEl) {
      const c = tools.length;
      subEl.innerHTML = c > 0
        ? `Your vault holds <strong>${c}</strong> ${c === 1 ? 'tool' : 'tools'} — keep discovering!`
        : `Your vault is empty — start adding tools! 🚀`;
    }
    // Update stat cards
    const cats = new Set(tools.map(t => t.category));
    const setTxt = (id, v) => { const e = document.getElementById(id); if (e) e.textContent = v; };
    setTxt('statTotal', tools.length);
    setTxt('statCategories', cats.size);
    setTxt('statFree', tools.filter(t => t.pricing === 'Free' || t.pricing === 'Freemium').length);
    setTxt('statPaid', tools.filter(t => t.pricing === 'Paid').length);
  }

  function updateAvatar() {
    if (!currentUser) return;
    const el = $('#userAvatar');
    const initials = currentUser.name.split(/\s+/).map(w => w[0]).join('').slice(0, 2).toUpperCase();
    if (el) {
      if (currentUser.avatar) {
        el.textContent = '';
        el.style.backgroundImage = `url(${currentUser.avatar})`;
        el.style.backgroundSize = 'cover';
        el.style.backgroundPosition = 'center';
      } else {
        el.textContent = initials;
        el.style.backgroundImage = '';
      }
      el.title = currentUser.name;
    }
    // Update dropdown avatar too
    const ddAvatar = $('#dropdownAvatar');
    if (ddAvatar) {
      if (currentUser.avatar) {
        ddAvatar.textContent = '';
        ddAvatar.style.backgroundImage = `url(${currentUser.avatar})`;
        ddAvatar.style.backgroundSize = 'cover';
        ddAvatar.style.backgroundPosition = 'center';
      } else {
        ddAvatar.textContent = initials;
        ddAvatar.style.backgroundImage = '';
      }
    }
  }

  /* ===== Categories ===== */
  const CATEGORIES = [
    'Coding & Development','Audio','Video & Images','Writing & Content',
    'Workflow Automation','Research & Analysis','Design & UI',
    'Chatbots & Assistants','Data & Analytics','Other'
  ];
  const catClassMap = {
    'Coding & Development':'cat-coding','Audio':'cat-audio','Video & Images':'cat-video',
    'Writing & Content':'cat-writing','Workflow Automation':'cat-workflow','Research & Analysis':'cat-research',
    'Design & UI':'cat-design','Chatbots & Assistants':'cat-chatbots','Data & Analytics':'cat-data','Other':'cat-other',
  };
  const catIconMap = {
    'Coding & Development':'💻','Audio':'🎵','Video & Images':'🎬','Writing & Content':'✍️',
    'Workflow Automation':'⚙️','Research & Analysis':'🔬','Design & UI':'🎨',
    'Chatbots & Assistants':'🤖','Data & Analytics':'📊','Other':'📦',
  };

  function renderCategoryFilters() {
    const used = new Set(tools.map(t => t.category));
    const cats = CATEGORIES.filter(c => used.has(c));
    categoryFiltersEl.innerHTML =
      `<button class="sidebar-item ${activeCategory === 'All' ? 'active' : ''}" data-filter="All">
        <span class="sidebar-icon">📁</span> All Tools <span style="margin-left:auto;font-size:11px;opacity:0.5">${tools.length}</span>
      </button>` +
      cats.map(c => {
        const count = tools.filter(t => t.category === c).length;
        return `<button class="sidebar-item ${activeCategory === c ? 'active' : ''}" data-filter="${c}">
          <span class="sidebar-icon">${catIconMap[c] || '📦'}</span> ${c} <span style="margin-left:auto;font-size:11px;opacity:0.5">${count}</span>
        </button>`;
      }).join('');
  }

  /* ===== Render ===== */
  function getUserToolLimit() { return (currentUser && currentUser.tool_limit) || 10; }

  function updateTierCounter() {
    const count = tools.length;
    const limit = getUserToolLimit();
    const el = $('#toolCount');
    const limitEl = $('#toolLimit');
    const bar = $('#toolProgressBar');
    if (el) el.textContent = count;
    if (limitEl) limitEl.textContent = limit;
    if (bar) {
      const pct = Math.min((count / limit) * 100, 100);
      bar.style.width = pct + '%';
      bar.classList.toggle('tier-full', count >= limit);
    }
    updateReferralWidget();
  }

  function referralProgressHTML(refCount, maxRefs, size) {
    const sm = size === 'sm';
    const dotSize = sm ? 20 : 24;
    const iconSize = sm ? 10 : 12;
    const unlocked = refCount * 2;
    return `
      <div class="referral-dots${sm ? ' referral-dots-sm' : ''}">
        ${Array.from({ length: maxRefs }, (_, i) =>
          `<div class="referral-dot ${i < refCount ? 'filled' : ''}" style="width:${dotSize}px;height:${dotSize}px">
            <svg width="${iconSize}" height="${iconSize}" viewBox="-1 0 19 24" fill="${i < refCount ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2"><path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="8.5" cy="7" r="4"/></svg>
          </div>`
        ).join('')}
      </div>
      <span class="referral-count">${refCount}/${maxRefs} joined · <strong>+${unlocked} slots</strong> unlocked</span>`;
  }

  function updateReferralWidget() {
    if (!currentUser) return;
    const refCount = currentUser.referral_count || 0;
    const maxRefs = 5;
    const progressWrap = $('#referralProgress');
    const linkInput = $('#referralLinkInput');
    if (progressWrap) {
      progressWrap.innerHTML = referralProgressHTML(refCount, maxRefs);
    }
    if (linkInput && currentUser.invite_code) {
      linkInput.value = `${location.origin}/join/${currentUser.invite_code}`;
    }
    // Update stacks inline widget
    const stacksWidget = $('#stacksInviteWidget');
    if (stacksWidget && currentUser.invite_code) {
      stacksWidget.innerHTML = `
        <div class="stacks-invite-progress">${referralProgressHTML(refCount, maxRefs, 'sm')}</div>
        <button class="stacks-invite-copy" id="stacksInviteCopyBtn" data-link="${location.origin}/join/${currentUser.invite_code}">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
          Copy Invite Link
        </button>`;
    }
  }

  function render() {
    renderCategoryFilters();
    updateGreeting();
    renderStacks();
    updateTierCounter();
    const filtered = tools.filter(t => {
      if (activeCategory !== 'All' && t.category !== activeCategory) return false;
      if (activePricing !== 'All' && t.pricing !== activePricing) return false;
      if (searchQuery) {
        const q = searchQuery.toLowerCase();
        return t.name.toLowerCase().includes(q) || (t.description||'').toLowerCase().includes(q) ||
               (t.notes||'').toLowerCase().includes(q) || t.category.toLowerCase().includes(q);
      }
      return true;
    });

    emptyState.style.display = filtered.length === 0 ? 'flex' : 'none';
    cardsGrid.style.display  = filtered.length === 0 ? 'none' : 'grid';

    cardsGrid.innerHTML = filtered.map((t, i) => {
      const initials = t.name.slice(0, 2);
      const catClass = catClassMap[t.category] || 'cat-other';
      const linkHtml = t.url ? `<a class="card-link" href="${esc(t.url)}" target="_blank" rel="noopener noreferrer">Visit ↗</a>` : '';
      const notesHtml = t.notes ? `<div class="card-notes">${esc(t.notes)}</div>` : '';
      const descHtml = t.description ? `<div class="card-desc">${esc(t.description)}</div>` : '';
      const domain = t.url ? t.url.replace(/^https?:\/\//, '').replace(/\/.*$/, '') : '';
      const faviconHtml = domain
        ? `<img class="card-favicon" src="https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=64" alt="" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'">`
        : '';
      const fallbackAvatar = `<div class="card-avatar-fallback ${catClass}" ${domain ? 'style="display:none"' : ''}>${esc(initials)}</div>`;

      return `
        <div class="card" style="animation-delay:${i * 40}ms" data-id="${t.id}" draggable="true">
          <div class="card-header">
            <div class="card-avatar-wrap">
              ${faviconHtml}${fallbackAvatar}
            </div>
            <div class="card-title-group">
              <div class="card-name" title="${esc(t.name)}">${esc(t.name)}</div>
              ${domain ? `<div class="card-url">${esc(domain)}</div>` : ''}
            </div>
            <div class="card-actions">
              <button title="Edit" data-edit="${t.id}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg></button>
              <button title="Delete" data-delete="${t.id}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg></button>
            </div>
          </div>
          <div class="card-body">
            <div class="card-badges">
              <span class="badge badge-category">${catIconMap[t.category]||'📦'} ${esc(t.category)}</span>
              <span class="badge badge-pricing" data-pricing="${t.pricing}">${t.pricing}</span>
            </div>
            ${descHtml}${notesHtml}
          </div>
          <div class="card-footer">
            ${linkHtml}
            <span class="card-date">${new Date(t.created_at || Date.now()).toLocaleDateString('en-GB', {day:'numeric',month:'short'})}</span>
          </div>
        </div>`;
    }).join('');

    // Append invite CTA placeholder card at the end
    if (currentUser && currentUser.invite_code) {
      const inviteLink = `${location.origin}/join/${currentUser.invite_code}`;
      const limit = getUserToolLimit();
      const slotsLeft = Math.max(0, 20 - limit);
      const refCount = currentUser.referral_count || 0;
      if (slotsLeft > 0) {
        cardsGrid.innerHTML += `
          <div class="card card-invite-cta">
            <div class="invite-cta-inner">
              <div class="invite-cta-icon">
                <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="8.5" cy="7" r="4"/><line x1="20" y1="8" x2="20" y2="14"/><line x1="23" y1="11" x2="17" y2="11"/></svg>
              </div>
              <div class="invite-cta-title">Unlock more slots</div>
              <div class="invite-cta-desc">Each friend who joins = <strong>+2 tool slots</strong> for you</div>
              <div class="invite-cta-progress">${referralProgressHTML(refCount, 5, 'sm')}</div>
              <button class="invite-cta-copy btn-primary btn-sm" data-link="${inviteLink}">Copy Invite Link</button>
            </div>
          </div>`;
      }
    }
  }

  function esc(str) {
    const d = document.createElement('div');
    d.textContent = str || '';
    return d.innerHTML;
  }

  /* ===== Modal ===== */
  function openModal(tool) {
    if (tool) {
      $('#modalTitle').textContent = 'Edit AI Tool';
      $('#editId').value = tool.id;
      $('#toolName').value = tool.name;
      $('#toolUrl').value = tool.url || '';
      $('#toolPricing').value = tool.pricing;
      $('#toolCategory').value = tool.category;
      $('#toolDescription').value = tool.description || '';
      $('#toolNotes').value = tool.notes || '';
    } else {
      const limit = getUserToolLimit();
      if (tools.length >= limit) {
        alert(`Tool limit reached (${limit}/${limit}). Invite friends to unlock more slots!`);
        return;
      }
      $('#modalTitle').textContent = 'Add AI Tool';
      toolForm.reset();
      $('#editId').value = '';
    }
    modalOverlay.classList.add('open');
    setTimeout(() => $('#toolName').focus(), 150);
  }
  function closeModal() { modalOverlay.classList.remove('open'); }

  function openDelete(id) {
    const t = tools.find(x => x.id === id);
    if (!t) return;
    deleteTargetId = id;
    $('#deleteName').textContent = t.name;
    deleteOverlay.classList.add('open');
  }
  function closeDelete() { deleteOverlay.classList.remove('open'); deleteTargetId = null; }

  /* ===== Save (API) ===== */
  toolForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const id = $('#editId').value;
    const body = {
      name: $('#toolName').value.trim(),
      url: $('#toolUrl').value.trim(),
      pricing: $('#toolPricing').value,
      category: $('#toolCategory').value,
      description: $('#toolDescription').value.trim(),
      notes: $('#toolNotes').value.trim(),
    };
    if (!body.name) return;

    try {
      if (id) {
        const data = await api(`/api/tools/${id}`, { method: 'PUT', body: JSON.stringify(body) });
        tools = tools.map(t => t.id === Number(id) ? data.tool : t);
      } else {
        const data = await api('/api/tools', { method: 'POST', body: JSON.stringify(body) });
        tools.unshift(data.tool);
      }
      closeModal();
      render();
    } catch (err) { alert(err.message); }
  });

  /* ===== Delete (API) ===== */
  $('#deleteConfirmBtn').addEventListener('click', async () => {
    if (!deleteTargetId) return;
    try {
      await api(`/api/tools/${deleteTargetId}`, { method: 'DELETE' });
      tools = tools.filter(t => t.id !== deleteTargetId);
      closeDelete();
      render();
    } catch (err) { alert(err.message); }
  });

  /* ===== Auto-detect description (server proxy) ===== */
  $('#fetchDescBtn').addEventListener('click', async () => {
    const url = $('#toolUrl').value.trim();
    if (!url) { alert('Enter a URL first.'); return; }
    const btn = $('#fetchDescBtn');
    btn.textContent = '⏳ Fetching…';
    btn.disabled = true;
    try {
      const data = await api(`/api/fetch-description?url=${encodeURIComponent(url)}`);
      if (data.description) {
        $('#toolDescription').value = data.description;
      } else {
        alert('Could not find a description. Add one manually.');
      }
    } catch {
      alert('Failed to fetch. Please add a description manually.');
    } finally {
      btn.textContent = 'Auto-detect description';
      btn.disabled = false;
    }
  });

  /* ===== Export CSV ===== */
  function csvEsc(val) {
    const s = String(val ?? '');
    return (s.includes(',') || s.includes('"') || s.includes('\n')) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }

  $('#exportBtn').addEventListener('click', () => {
    if (tools.length === 0) { alert('Nothing to export.'); return; }
    const h = ['name','url','category','pricing','description','notes'];
    const rows = [h.join(','), ...tools.map(t => h.map(k => csvEsc(t[k])).join(','))];
    const blob = new Blob([rows.join('\n')], { type: 'text/csv;charset=utf-8;' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `aidock-tools-${new Date().toISOString().slice(0,10)}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  });

  /* ===== Import CSV ===== */
  function parseCsvLine(line) {
    const result = []; let cur = ''; let inQ = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (inQ) { if (c === '"' && line[i+1] === '"') { cur += '"'; i++; } else if (c === '"') inQ = false; else cur += c; }
      else { if (c === '"') inQ = true; else if (c === ',') { result.push(cur); cur = ''; } else cur += c; }
    }
    result.push(cur);
    return result;
  }

  $('#importBtn').addEventListener('click', () => $('#importFile').click());
  $('#importFile').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const text = await file.text();
    const lines = text.split(/\r?\n/).filter(l => l.trim());
    if (lines.length < 2) { alert('CSV is empty.'); return; }

    const headers = parseCsvLine(lines[0]).map(h => h.trim().toLowerCase());
    const nameIdx = headers.indexOf('name');
    if (nameIdx === -1) { alert('CSV must have a "name" column.'); return; }

    const fieldMap = { url:'url', category:'category', pricing:'pricing', description:'description', notes:'notes' };
    const toImport = [];

    for (let i = 1; i < lines.length; i++) {
      const cols = parseCsvLine(lines[i]);
      const name = (cols[nameIdx] || '').trim();
      if (!name) continue;
      const tool = { name, url:'', category:'Other', pricing:'Unknown', description:'', notes:'' };
      for (const [key, field] of Object.entries(fieldMap)) {
        const idx = headers.indexOf(key);
        if (idx !== -1 && cols[idx]) tool[field] = cols[idx].trim();
      }
      if (!CATEGORIES.includes(tool.category)) tool.category = 'Other';
      if (!['Free','Freemium','Paid','Unknown'].includes(tool.pricing)) tool.pricing = 'Unknown';
      toImport.push(tool);
    }

    if (toImport.length === 0) { alert('No valid rows found.'); return; }

    try {
      const data = await api('/api/tools/import', { method: 'POST', body: JSON.stringify({ tools: toImport }) });
      await loadTools();
      render();
      alert(`Imported ${data.imported} tool(s).`);
    } catch (err) { alert(err.message); }
    e.target.value = '';
  });

  /* ===== Events ===== */
  // User menu
  $('#userAvatar').addEventListener('click', (e) => {
    e.stopPropagation();
    const dd = $('#userDropdown');
    dd.classList.toggle('open');
    if (currentUser) {
      $('#userDropdownName').textContent = currentUser.name;
      $('#userDropdownEmail').textContent = currentUser.email;
      const rolesEl = $('#userDropdownRoles');
      const roles = [currentUser.primary_role, currentUser.secondary_role].filter(Boolean);
      rolesEl.innerHTML = roles.length
        ? roles.map(r => `<span class="user-role-badge">${r}</span>`).join('')
        : '<span class="user-role-empty">No roles set</span>';
    }
  });
  document.addEventListener('click', () => $('#userDropdown').classList.remove('open'));

  $('#logoutBtn').addEventListener('click', async () => {
    await fetch('/api/auth/logout', { method: 'POST' });
    window.location.href = '/';
  });

  const ROLE_OPTIONS = ['Marketing','Frontend Development','Backend Development','Full Stack Development','UI/UX Design','Graphic Design','Data Science','Data Analytics','Product Management','Project Management','Content Writing','Copywriting','Sales','Customer Support','HR / People Ops','Finance / Accounting','Legal','DevOps / SRE','Cybersecurity','AI / ML Engineering','Research','Education / Training','Video / Audio Production','Consulting','Founder / Entrepreneur','Student','Other'];

  // Change avatar from dropdown
  $('#changeAvatarBtn').addEventListener('click', (e) => {
    e.stopPropagation();
    $('#dashboardAvatarInput').click();
  });
  $('#dashboardAvatarInput').addEventListener('change', async () => {
    const file = $('#dashboardAvatarInput').files[0];
    if (!file) return;
    if (file.size > 1.5 * 1024 * 1024) { alert('Image too large. Max 1.5MB.'); return; }
    const reader = new FileReader();
    reader.onload = async (ev) => {
      const avatar = ev.target.result;
      try {
        const res = await api('/api/auth/avatar', { method: 'PUT', body: JSON.stringify({ avatar }) });
        if (res.ok || res.avatar) {
          currentUser.avatar = res.avatar || avatar;
          updateAvatar();
        }
      } catch {}
    };
    reader.readAsDataURL(file);
  });

  $('#editRolesBtn').addEventListener('click', () => {
    $('#userDropdown').classList.remove('open');
    const pr = currentUser.primary_role || '';
    const sr = currentUser.secondary_role || '';
    const opts = ROLE_OPTIONS.map(r => `<option value="${r}">${r}</option>`).join('');
    const overlay = document.createElement('div');
    overlay.className = 'stack-tool-edit-overlay';
    overlay.innerHTML = `
      <div class="stack-tool-edit-modal">
        <h3>Edit Your Roles</h3>
        <label>Primary Role *</label>
        <select id="editPrimaryRole">
          <option value="" disabled>Select role</option>
          ${opts}
        </select>
        <label>Secondary Role <span style="opacity:.5;font-weight:400">(optional)</span></label>
        <select id="editSecondaryRole">
          <option value="">None</option>
          ${opts}
        </select>
        <div class="stack-tool-edit-actions">
          <button class="btn-secondary btn-sm" id="rolesCancelBtn">Cancel</button>
          <button class="btn-primary btn-sm" id="rolesSaveBtn">Save</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);
    if (pr) overlay.querySelector('#editPrimaryRole').value = pr;
    if (sr) overlay.querySelector('#editSecondaryRole').value = sr;
    overlay.querySelector('#rolesCancelBtn').addEventListener('click', () => overlay.remove());
    overlay.querySelector('#rolesSaveBtn').addEventListener('click', async () => {
      const newPr = overlay.querySelector('#editPrimaryRole').value;
      const newSr = overlay.querySelector('#editSecondaryRole').value;
      if (!newPr) { alert('Please select a primary role.'); return; }
      try {
        await api('/api/auth/profile', { method: 'PUT', body: JSON.stringify({ primary_role: newPr, secondary_role: newSr }) });
        currentUser.primary_role = newPr;
        currentUser.secondary_role = newSr;
        overlay.remove();
      } catch (err) { alert(err.message); }
    });
  });

  // Referral copy button (sidebar)
  $('#referralCopyBtn').addEventListener('click', () => {
    const input = $('#referralLinkInput');
    if (!input || !input.value) return;
    copyInviteLink(input.value, $('#referralCopyBtn'));
  });

  // Pro paywall
  const proOverlay = $('#proOverlay');
  $('#getProBtn').addEventListener('click', () => proOverlay.classList.add('open'));
  $('#proClose').addEventListener('click', () => proOverlay.classList.remove('open'));
  proOverlay.addEventListener('click', (e) => { if (e.target === proOverlay) proOverlay.classList.remove('open'); });
  proOverlay.querySelectorAll('.pro-plan-btn').forEach(btn => {
    btn.addEventListener('click', () => alert('Pro subscriptions coming soon! 🚀'));
  });

  // Limit Paywall
  const limitOverlay = $('#limitOverlay');
  $('#limitClose').addEventListener('click', () => limitOverlay.classList.remove('open'));
  limitOverlay.addEventListener('click', (e) => { if (e.target === limitOverlay) limitOverlay.classList.remove('open'); });
  limitOverlay.querySelectorAll('.limit-pro-btn').forEach(btn => {
    btn.addEventListener('click', () => alert('Pro subscriptions coming soon! 🚀'));
  });
  $('#limitCopyBtn').addEventListener('click', () => {
    copyInviteLink($('#limitInviteLink').value, $('#limitCopyBtn'));
  });

  function openLimitPaywall() {
    const limit = getUserToolLimit();
    $('#limitCount').textContent = tools.length;
    $('#limitMax').textContent = limit;
    // Referral progress
    const refCount = currentUser.referral_count || 0;
    const maxRefs = 5;
    $('#limitReferralProgress').innerHTML = referralProgressHTML(refCount, maxRefs, 'sm');
    // Invite link
    const code = currentUser.invite_code || '';
    $('#limitInviteLink').value = location.origin + '/join/' + code;
    limitOverlay.classList.add('open');
  }

  function addToolWithLimitCheck() {
    const limit = getUserToolLimit();
    if (tools.length >= limit) {
      openLimitPaywall();
    } else {
      openModal();
    }
  }

  $('#addToolBtn').addEventListener('click', () => addToolWithLimitCheck());
  $('#emptyAddBtn').addEventListener('click', () => addToolWithLimitCheck());

  // Copy invite link helper with toast
  function copyInviteLink(link, btnEl) {
    navigator.clipboard.writeText(link).then(() => {
      // Show toast
      let toast = document.querySelector('.invite-toast');
      if (!toast) {
        toast = document.createElement('div');
        toast.className = 'invite-toast';
        document.body.appendChild(toast);
      }
      toast.textContent = '✓ Invite link copied — share it with your friend!';
      toast.classList.add('show');
      setTimeout(() => toast.classList.remove('show'), 2500);
      // Button feedback
      if (btnEl) {
        const orig = btnEl.innerHTML;
        btnEl.innerHTML = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><polyline points="20 6 9 17 4 12"/></svg> Copied!';
        btnEl.classList.add('copied');
        setTimeout(() => { btnEl.innerHTML = orig; btnEl.classList.remove('copied'); }, 2200);
      }
    });
  }

  // Stacks invite widget copy
  document.addEventListener('click', (e) => {
    const btn = e.target.closest('#stacksInviteCopyBtn');
    if (btn) { copyInviteLink(btn.dataset.link, btn); return; }
  });

  // Delegate click for invite CTA copy buttons in card grid
  cardsGrid.addEventListener('click', (e) => {
    const copyBtn = e.target.closest('.invite-cta-copy');
    if (copyBtn) { copyInviteLink(copyBtn.dataset.link, copyBtn); return; }
  });

  $('#modalClose').addEventListener('click', closeModal);
  $('#cancelBtn').addEventListener('click', closeModal);
  $('#deleteClose').addEventListener('click', closeDelete);
  $('#deleteCancelBtn').addEventListener('click', closeDelete);
  modalOverlay.addEventListener('click', (e) => { if (e.target === modalOverlay) closeModal(); });
  deleteOverlay.addEventListener('click', (e) => { if (e.target === deleteOverlay) closeDelete(); });

  cardsGrid.addEventListener('click', (e) => {
    const editBtn = e.target.closest('[data-edit]');
    const delBtn  = e.target.closest('[data-delete]');
    if (editBtn) { const t = tools.find(x => x.id === Number(editBtn.dataset.edit)); if (t) openModal(t); }
    if (delBtn) openDelete(Number(delBtn.dataset.delete));
  });

  searchInput.addEventListener('input', (e) => { searchQuery = e.target.value; render(); });

  categoryFiltersEl.addEventListener('click', (e) => {
    const item = e.target.closest('.sidebar-item');
    if (!item) return;
    activeCategory = item.dataset.filter;
    render();
  });

  pricingFiltersEl.addEventListener('click', (e) => {
    const item = e.target.closest('.sidebar-item');
    if (!item) return;
    pricingFiltersEl.querySelectorAll('.sidebar-item').forEach(c => c.classList.remove('active'));
    item.classList.add('active');
    activePricing = item.dataset.pricing;
    render();
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { closeModal(); closeDelete(); closeStackModal(); closeFolder(); }
    if ((e.metaKey || e.ctrlKey) && e.key === 'k') { e.preventDefault(); searchInput.focus(); }
  });

  /* ===== Stacks ===== */
  let stacks = [];
  let openStackId = null;
  const stacksDock        = $('#stacksDock');
  const stacksSection     = $('#stacksSection');
  const folderOverlay     = $('#folderOverlay');
  const folderGrid        = $('#folderGrid');
  const folderEmpty       = $('#folderEmpty');
  const stackModalOverlay = $('#stackModalOverlay');
  const stackForm         = $('#stackForm');

  async function loadStacks() {
    const data = await api('/api/stacks');
    stacks = data.stacks;
  }

  function renderStacks() {
    stacksSection.style.display = 'block';
    stacksDock.innerHTML = stacks.map(s => {
      const stackTools = s.tool_ids.map(id => tools.find(t => t.id === id)).filter(Boolean);
      const previews = stackTools.slice(0, 4);
      let faviconsHtml = '';
      if (previews.length > 0) {
        faviconsHtml = previews.map(t => {
          const domain = t.url ? t.url.replace(/^https?:\/\//, '').replace(/\/.*$/, '') : '';
          if (domain) {
            return `<img class="sf-icon" src="https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=64" alt="">`;
          }
          return `<span class="sf-icon" style="display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:700;color:var(--accent)">${esc(t.name.slice(0,1))}</span>`;
        }).join('');
        if (stackTools.length > 4) {
          faviconsHtml += `<span class="sf-more">+${stackTools.length - 4}</span>`;
        }
      }
      const countText = stackTools.length === 0 ? 'Empty' : `${stackTools.length} tool${stackTools.length !== 1 ? 's' : ''}`;
      const sharedBadge = s.share_slug ? '<span class="stack-shared-badge" title="Shared">🔗</span>' : '';
      return `
        <div class="stack-item" data-stack-id="${s.id}" draggable="false">
          <div class="stack-icon-bg" style="background:${esc(s.color)}"></div>
          <div class="stack-icon-wrap" style="background:${esc(s.color)}15">${esc(s.icon || '📂')}</div>
          <div class="stack-info">
            <div class="stack-label">${esc(s.name)}</div>
            <div class="stack-meta"><span class="stack-count">${countText}</span>${sharedBadge}</div>
          </div>
          ${faviconsHtml ? `<div class="stack-favicons">${faviconsHtml}</div>` : ''}
        </div>`;
    }).join('');
  }

  function openStackModal(stack) {
    if (stack) {
      $('#stackModalTitle').textContent = 'Edit Stack';
      $('#stackEditId').value = stack.id;
      $('#stackName').value = stack.name;
      $('#stackDescription').value = stack.description || '';
      $('#stackColor').value = stack.color || '#0a84ff';
      $('#stackColorPreview').style.background = stack.color || '#0a84ff';
      setSelectedIcon(stack.icon || '📂');
    } else {
      $('#stackModalTitle').textContent = 'New Stack';
      stackForm.reset();
      $('#stackEditId').value = '';
      $('#stackColor').value = '#0a84ff';
      $('#stackColorPreview').style.background = '#0a84ff';
      setSelectedIcon('📂');
    }
    stackModalOverlay.classList.add('open');
    setTimeout(() => $('#stackName').focus(), 150);
  }
  function closeStackModal() { stackModalOverlay.classList.remove('open'); }

  function setSelectedIcon(icon) {
    document.querySelectorAll('#iconPickerRow .icon-option').forEach(btn => {
      btn.classList.toggle('selected', btn.dataset.icon === icon);
    });
  }
  function getSelectedIcon() {
    const sel = document.querySelector('#iconPickerRow .icon-option.selected');
    return sel ? sel.dataset.icon : '📂';
  }

  // Icon picker clicks
  document.getElementById('iconPickerRow').addEventListener('click', (e) => {
    const btn = e.target.closest('.icon-option');
    if (!btn) return;
    setSelectedIcon(btn.dataset.icon);
  });

  // Color preview sync
  $('#stackColor').addEventListener('input', (e) => {
    $('#stackColorPreview').style.background = e.target.value;
  });

  // Stack form submit
  stackForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const id = $('#stackEditId').value;
    const body = {
      name: $('#stackName').value.trim(),
      description: $('#stackDescription').value.trim(),
      color: $('#stackColor').value,
      icon: getSelectedIcon(),
    };
    if (!body.name) return;
    try {
      if (id) {
        const data = await api(`/api/stacks/${id}`, { method: 'PUT', body: JSON.stringify(body) });
        stacks = stacks.map(s => s.id === Number(id) ? data.stack : s);
      } else {
        const data = await api('/api/stacks', { method: 'POST', body: JSON.stringify(body) });
        stacks.unshift(data.stack);
      }
      closeStackModal();
      renderStacks();
      if (openStackId) openFolder(stacks.find(s => s.id === openStackId));
    } catch (err) { alert(err.message); }
  });

  // Stack create + cancel + close
  $('#createStackBtn').addEventListener('click', () => openStackModal());
  $('#stackCancelBtn').addEventListener('click', closeStackModal);
  $('#stackModalClose').addEventListener('click', closeStackModal);
  stackModalOverlay.addEventListener('click', (e) => { if (e.target === stackModalOverlay) closeStackModal(); });

  // Click stack to open folder
  stacksDock.addEventListener('click', (e) => {
    const item = e.target.closest('.stack-item');
    if (!item) return;
    const s = stacks.find(x => x.id === Number(item.dataset.stackId));
    if (s) openFolder(s);
  });

  function openFolder(stack) {
    openStackId = stack.id;
    $('#folderName').innerHTML = `<span>${esc(stack.icon || '📂')}</span> ${esc(stack.name)}`;
    $('#folderDesc').textContent = stack.description || '';
    const stackTools = stack.tool_ids.map(id => tools.find(t => t.id === id)).filter(Boolean);

    // Stats
    const categories = new Set(stackTools.map(t => t.category));
    $('#folderToolCount').innerHTML = `${stackTools.length} tool${stackTools.length !== 1 ? 's' : ''} · ${categories.size} categor${categories.size !== 1 ? 'ies' : 'y'}`;

    // Share panel state
    const sharePanel = $('#folderSharePanel');
    const shareBtn = $('#folderShareBtn');
    sharePanel.style.display = 'none';
    shareBtn.classList.toggle('active', !!stack.share_slug);

    folderEmpty.style.display = stackTools.length === 0 ? 'block' : 'none';
    folderGrid.style.display = stackTools.length === 0 ? 'none' : 'grid';
    folderGrid.innerHTML = stackTools.map(t => {
      const domain = t.url ? t.url.replace(/^https?:\/\//, '').replace(/\/.*$/, '') : '';
      const faviconHtml = domain
        ? `<img class="folder-tool-favicon" src="https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=64" alt="" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'">`
        : '';
      const fallback = `<div class="folder-tool-fallback" ${domain ? 'style="display:none"' : ''}>${esc(t.name.slice(0,2))}</div>`;
      const linkHtml = t.url ? `<a class="folder-tool-link" href="${esc(t.url)}" target="_blank" rel="noopener noreferrer">Visit ↗</a>` : '';
      const meta = (stack.stack_tool_meta && stack.stack_tool_meta[t.id]) || {};
      const desc = meta.description || t.description || '';
      const notes = meta.notes || t.notes || '';
      const descHtml = desc ? `<div class="folder-tool-desc">${esc(desc)}</div>` : '<div class="folder-tool-desc folder-tool-desc-empty">Add description…</div>';
      const notesHtml = notes ? `<div class="folder-tool-notes">💬 ${esc(notes)}</div>` : '<div class="folder-tool-notes folder-tool-notes-empty">Add notes…</div>';
      return `
        <div class="folder-tool" data-tool-id="${t.id}">
          <button class="folder-tool-remove" data-remove-tool="${t.id}" title="Remove from stack">✕</button>
          ${faviconHtml}${fallback}
          <span class="folder-tool-name" title="${esc(t.name)}">${esc(t.name)}</span>
          <span class="folder-tool-category">${catIconMap[t.category]||'📦'} ${esc(t.category)}</span>
          ${descHtml}
          ${notesHtml}
          <div class="folder-tool-actions">
            <button class="folder-tool-edit-btn" data-edit-stack-tool="${t.id}" title="Edit description & notes">✏️ Edit</button>
            ${linkHtml}
          </div>
        </div>`;
    }).join('');
    // Make folder a drop target
    folderOverlay.classList.add('open');
  }
  function closeFolder() {
    folderOverlay.classList.remove('open');
    openStackId = null;
  }

  $('#folderCloseBtn').addEventListener('click', closeFolder);
  $('#folderBackdrop').addEventListener('click', closeFolder);

  // Share button — toggle share panel
  $('#folderShareBtn').addEventListener('click', async () => {
    const panel = $('#folderSharePanel');
    if (panel.style.display !== 'none') {
      panel.style.display = 'none';
      return;
    }
    const s = stacks.find(x => x.id === openStackId);
    if (!s) return;
    // Generate share slug if needed
    if (!s.share_slug) {
      try {
        const data = await api(`/api/stacks/${s.id}/share`, { method: 'POST' });
        s.share_slug = data.slug;
      } catch (err) { alert(err.message); return; }
    }
    const shareUrl = `${window.location.origin}/stack/${s.share_slug}`;
    $('#shareLinkInput').value = shareUrl;
    $('#shareViews').textContent = s.views || 0;
    $('#shareClones').textContent = s.clones || 0;
    $('#folderShareBtn').classList.add('active');
    panel.style.display = 'block';
  });

  // Copy share link
  $('#shareCopyBtn').addEventListener('click', () => {
    const input = $('#shareLinkInput');
    navigator.clipboard.writeText(input.value).then(() => {
      const btn = $('#shareCopyBtn');
      btn.textContent = 'Copied!';
      setTimeout(() => btn.textContent = 'Copy', 1500);
    });
  });

  // Social sharing
  $('#shareTwitterBtn').addEventListener('click', () => {
    const s = stacks.find(x => x.id === openStackId);
    if (!s || !s.share_slug) return;
    const url = `${window.location.origin}/stack/${s.share_slug}`;
    const text = `Check out my "${s.name}" AI tools stack on AIDock! 🚀`;
    window.open(`https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}&url=${encodeURIComponent(url)}`, '_blank', 'width=550,height=420');
  });
  $('#shareLinkedInBtn').addEventListener('click', () => {
    const s = stacks.find(x => x.id === openStackId);
    if (!s || !s.share_slug) return;
    const url = `${window.location.origin}/stack/${s.share_slug}`;
    window.open(`https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(url)}`, '_blank', 'width=550,height=420');
  });
  $('#shareEmailBtn').addEventListener('click', () => {
    const s = stacks.find(x => x.id === openStackId);
    if (!s || !s.share_slug) return;
    const url = `${window.location.origin}/stack/${s.share_slug}`;
    const subject = `Check out my "${s.name}" AI tools stack`;
    const body = `I curated a collection of AI tools on AIDock:\n\n${url}`;
    window.location.href = `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  });

  // Unshare
  $('#shareUnshareBtn').addEventListener('click', async () => {
    if (!openStackId) return;
    const s = stacks.find(x => x.id === openStackId);
    if (!s) return;
    if (!confirm('Stop sharing this stack? The public link will no longer work.')) return;
    try {
      await api(`/api/stacks/${s.id}/share`, { method: 'DELETE' });
      s.share_slug = null;
      $('#folderSharePanel').style.display = 'none';
      $('#folderShareBtn').classList.remove('active');
      renderStacks();
    } catch (err) { alert(err.message); }
  });

  // Edit / Delete stack from folder
  $('#folderEditBtn').addEventListener('click', () => {
    const s = stacks.find(x => x.id === openStackId);
    if (s) openStackModal(s);
  });
  $('#folderDeleteBtn').addEventListener('click', async () => {
    if (!openStackId) return;
    const s = stacks.find(x => x.id === openStackId);
    if (!confirm(`Delete stack "${s ? s.name : ''}"?`)) return;
    try {
      await api(`/api/stacks/${openStackId}`, { method: 'DELETE' });
      stacks = stacks.filter(x => x.id !== openStackId);
      closeFolder();
      renderStacks();
    } catch (err) { alert(err.message); }
  });

  // Remove tool from stack (inside folder)
  folderGrid.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-remove-tool]');
    if (!btn || !openStackId) return;
    const toolId = Number(btn.dataset.removeTool);
    try {
      await api(`/api/stacks/${openStackId}/tools/${toolId}`, { method: 'DELETE' });
      const s = stacks.find(x => x.id === openStackId);
      if (s) {
        s.tool_ids = s.tool_ids.filter(id => id !== toolId);
        openFolder(s);
        renderStacks();
      }
    } catch (err) { alert(err.message); }
  });

  // Edit stack tool description/notes
  folderGrid.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-edit-stack-tool]');
    if (!btn || !openStackId) return;
    const toolId = Number(btn.dataset.editStackTool);
    const s = stacks.find(x => x.id === openStackId);
    if (!s) return;
    const meta = (s.stack_tool_meta && s.stack_tool_meta[toolId]) || {};
    const toolObj = tools.find(t => t.id === toolId) || {};
    const toolName = toolObj.name || 'Tool';
    const editDesc = meta.description || toolObj.description || '';
    const editNotes = meta.notes || toolObj.notes || '';

    const overlay = document.createElement('div');
    overlay.className = 'stack-tool-edit-overlay';
    overlay.innerHTML = `
      <div class="stack-tool-edit-modal">
        <h3>Edit — ${esc(toolName)}</h3>
        <label>Description</label>
        <textarea id="steDesc" rows="3" placeholder="Why is this tool in this stack?">${esc(editDesc)}</textarea>
        <label>Notes / Comments</label>
        <textarea id="steNotes" rows="3" placeholder="Your personal notes…">${esc(editNotes)}</textarea>
        <div class="stack-tool-edit-actions">
          <button class="btn-secondary btn-sm" id="steCancelBtn">Cancel</button>
          <button class="btn-primary btn-sm" id="steSaveBtn">Save</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);
    overlay.querySelector('#steCancelBtn').addEventListener('click', () => overlay.remove());
    overlay.querySelector('#steSaveBtn').addEventListener('click', async () => {
      const desc = overlay.querySelector('#steDesc').value.trim();
      const notes = overlay.querySelector('#steNotes').value.trim();
      try {
        await api(`/api/stacks/${openStackId}/tools/${toolId}`, {
          method: 'PUT', body: JSON.stringify({ description: desc, notes })
        });
        if (!s.stack_tool_meta) s.stack_tool_meta = {};
        s.stack_tool_meta[toolId] = { description: desc, notes };
        overlay.remove();
        openFolder(s);
      } catch (err) { alert(err.message); }
    });
  });

  // Drop on folder overlay (when open)
  folderOverlay.addEventListener('dragover', (e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    folderOverlay.querySelector('.folder-container').style.boxShadow = '0 0 0 3px var(--accent), 0 24px 80px rgba(0,0,0,.25)';
  });
  folderOverlay.addEventListener('dragleave', (e) => {
    if (e.target === folderOverlay || e.target.classList.contains('folder-backdrop')) {
      folderOverlay.querySelector('.folder-container').style.boxShadow = '';
    }
  });
  folderOverlay.addEventListener('drop', async (e) => {
    e.preventDefault();
    folderOverlay.querySelector('.folder-container').style.boxShadow = '';
    const toolId = Number(e.dataTransfer.getData('text/plain'));
    if (!toolId || !openStackId) return;
    try {
      await api(`/api/stacks/${openStackId}/tools`, { method: 'POST', body: JSON.stringify({ tool_id: toolId }) });
      const s = stacks.find(x => x.id === openStackId);
      if (s && !s.tool_ids.includes(toolId)) {
        s.tool_ids.push(toolId);
        openFolder(s);
        renderStacks();
      }
    } catch (err) {
      if (!err.message.includes('already')) alert(err.message);
    }
  });

  /* ===== Card Drag & Drop ===== */
  // Floating drop zone for when stacks are scrolled out of view
  const floatingDock = document.createElement('div');
  floatingDock.className = 'floating-dock';
  floatingDock.innerHTML = '<div class="floating-dock-label">Drop on a stack</div><div class="floating-dock-items"></div>';
  document.body.appendChild(floatingDock);

  function showFloatingDock() {
    const stacksRect = stacksDock.getBoundingClientRect();
    const isVisible = stacksRect.bottom > 0 && stacksRect.top < window.innerHeight;
    if (!isVisible && stacks.length > 0) {
      const itemsEl = floatingDock.querySelector('.floating-dock-items');
      itemsEl.innerHTML = stacks.map(s => 
        `<div class="floating-dock-stack" data-stack-id="${s.id}">${esc(s.icon || '\ud83d\udcc2')} ${esc(s.name)}</div>`
      ).join('');
      floatingDock.classList.add('visible');
    } else {
      floatingDock.classList.remove('visible');
    }
  }

  floatingDock.addEventListener('dragover', (e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    const item = e.target.closest('.floating-dock-stack');
    floatingDock.querySelectorAll('.floating-dock-stack.drag-over').forEach(el => el.classList.remove('drag-over'));
    if (item) item.classList.add('drag-over');
  });
  floatingDock.addEventListener('dragleave', (e) => {
    const item = e.target.closest('.floating-dock-stack');
    if (item) item.classList.remove('drag-over');
  });
  floatingDock.addEventListener('drop', async (e) => {
    e.preventDefault();
    floatingDock.querySelectorAll('.floating-dock-stack.drag-over').forEach(el => el.classList.remove('drag-over'));
    const item = e.target.closest('.floating-dock-stack');
    if (!item) return;
    const stackId = Number(item.dataset.stackId);
    const toolId = Number(e.dataTransfer.getData('text/plain'));
    if (!stackId || !toolId) return;
    try {
      await api(`/api/stacks/${stackId}/tools`, { method: 'POST', body: JSON.stringify({ tool_id: toolId }) });
      const s = stacks.find(x => x.id === stackId);
      if (s && !s.tool_ids.includes(toolId)) {
        s.tool_ids.push(toolId);
        renderStacks();
      }
    } catch (err) {
      if (!err.message.includes('already')) alert(err.message);
    }
  });

  cardsGrid.addEventListener('dragstart', (e) => {
    const card = e.target.closest('.card');
    if (!card) return;
    card.classList.add('dragging');
    e.dataTransfer.setData('text/plain', card.dataset.id);
    e.dataTransfer.effectAllowed = 'copy';
    // Highlight dock as drop zone
    stacksDock.classList.add('drag-active');
    showFloatingDock();
  });
  cardsGrid.addEventListener('dragend', (e) => {
    const card = e.target.closest('.card');
    if (card) card.classList.remove('dragging');
    document.querySelectorAll('.stack-item.drag-over').forEach(el => el.classList.remove('drag-over'));
    stacksDock.classList.remove('drag-active');
    floatingDock.classList.remove('visible');
  });

  // Stack dock: drag over & drop
  stacksDock.addEventListener('dragover', (e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    const item = e.target.closest('.stack-item');
    document.querySelectorAll('.stack-item.drag-over').forEach(el => el.classList.remove('drag-over'));
    if (item) item.classList.add('drag-over');
  });
  stacksDock.addEventListener('dragleave', (e) => {
    const item = e.target.closest('.stack-item');
    if (item) item.classList.remove('drag-over');
  });
  stacksDock.addEventListener('drop', async (e) => {
    e.preventDefault();
    document.querySelectorAll('.stack-item.drag-over').forEach(el => el.classList.remove('drag-over'));
    const item = e.target.closest('.stack-item');
    if (!item) return;
    const stackId = Number(item.dataset.stackId);
    const toolId = Number(e.dataTransfer.getData('text/plain'));
    if (!stackId || !toolId) return;
    try {
      await api(`/api/stacks/${stackId}/tools`, { method: 'POST', body: JSON.stringify({ tool_id: toolId }) });
      const s = stacks.find(x => x.id === stackId);
      if (s && !s.tool_ids.includes(toolId)) {
        s.tool_ids.push(toolId);
        renderStacks();
      }
    } catch (err) {
      if (!err.message.includes('already')) alert(err.message);
    }
  });

  /* ===== View Toggle (My View / Social View) ===== */
  let currentView = 'my';
  const viewToggle = $('#viewToggle');
  const myViewEl = $('#dashboard');
  const socialViewEl = $('#socialView');
  const sidebarEl = $('#sidebar');
  const friendProfileOverlay = $('#friendProfileOverlay');

  viewToggle.addEventListener('click', (e) => {
    const btn = e.target.closest('.view-toggle-btn');
    if (!btn || btn.classList.contains('active')) return;
    const view = btn.dataset.view;
    router.navigate(view === 'social' ? '/dashboard/social' : '/dashboard');
  });

  // Social invite buttons
  function bindInviteBtn(btn) {
    if (!btn) return;
    btn.addEventListener('click', () => {
      if (currentUser && currentUser.invite_code) {
        const link = location.origin + '/join/' + currentUser.invite_code;
        navigator.clipboard.writeText(link).then(() => alert('Invite link copied! Share it with a friend.'));
      }
    });
  }
  bindInviteBtn($('#socialInviteBtn'));
  bindInviteBtn($('#socialInviteBtnEmpty'));

  /* ===== Friends ===== */
  let friendsCache = [];

  function moveFriendTabSlider(tab, instant) {
    const slider = document.querySelector('.friend-tab-slider');
    if (!slider || !tab) return;
    const parent = tab.parentElement;
    const parentRect = parent.getBoundingClientRect();
    const tabRect = tab.getBoundingClientRect();
    // Skip if not yet rendered (zero dimensions)
    if (tabRect.width === 0) {
      requestAnimationFrame(() => moveFriendTabSlider(tab, instant));
      return;
    }
    if (instant) slider.style.transition = 'none';
    slider.style.left = (tabRect.left - parentRect.left) + 'px';
    slider.style.width = tabRect.width + 'px';
    if (instant) {
      requestAnimationFrame(() => {
        slider.style.transition = '';
        slider.classList.add('ready');
      });
    } else {
      slider.classList.add('ready');
    }
  }

  async function loadFriends() {
    try {
      const data = await api('/api/friends');
      friendsCache = data.friends || [];
      renderFriends();
    } catch { friendsCache = []; renderFriends(); }
  }

  function renderFriends() {
    const grid = $('#friendsGrid');
    const empty = $('#friendsEmpty');
    const countEl = $('#friendsCount');
    if (countEl) countEl.textContent = friendsCache.length > 0 ? friendsCache.length + ' friend' + (friendsCache.length !== 1 ? 's' : '') : '';
    if (friendsCache.length === 0) {
      grid.innerHTML = '';
      grid.style.display = 'none';
      empty.style.display = '';
      return;
    }
    empty.style.display = 'none';
    grid.style.display = '';
    grid.innerHTML = friendsCache.map(f => {
      const initials = f.name.split(/\s+/).map(w => w[0]).join('').slice(0, 2).toUpperCase();
      const avatarStyle = f.avatar
        ? `background-image:url(${f.avatar});background-size:cover;background-position:center;color:transparent`
        : '';
      const roles = [f.primary_role, f.secondary_role].filter(Boolean).join(' · ') || 'No role set';
      return `
        <div class="friend-card" data-friend-id="${f.id}">
          <div class="friend-card-avatar" style="${avatarStyle}">${f.avatar ? '' : initials}</div>
          <div class="friend-card-name">${esc(f.name)}</div>
          <div class="friend-card-role">${esc(roles)}</div>
          <div class="friend-card-stats">
            <div class="friend-card-stat"><strong>${f.tool_count}</strong> Tools</div>
            <div class="friend-card-stat"><strong>${f.shared_stack_count}</strong> Stacks</div>
          </div>
        </div>`;
    }).join('');

    // Click handler for friend cards
    grid.querySelectorAll('.friend-card').forEach(card => {
      card.addEventListener('click', () => {
        const fid = Number(card.dataset.friendId);
        router.navigate('/dashboard/social/friend/' + fid);
      });
    });
  }

  /* ===== Friend Profile ===== */
  let friendProfileData = null;

  // Called by router to open friend profile by ID
  async function openFriendProfileById(friendId) {
    try {
      const data = await api('/api/friends/' + friendId + '/profile');
      friendProfileData = data;
      renderFriendProfile();
      friendProfileOverlay.style.display = '';
    } catch (err) {
      alert(err.message || 'Could not load friend profile.');
    }
  }

  function renderFriendProfile() {
    if (!friendProfileData) return;
    const { friend, tools: fTools, stacks: fStacks } = friendProfileData;
    const initials = friend.name.split(/\s+/).map(w => w[0]).join('').slice(0, 2).toUpperCase();
    const avatarStyle = friend.avatar
      ? `background-image:url(${friend.avatar});background-size:cover;background-position:center;color:transparent`
      : '';
    const roles = [friend.primary_role, friend.secondary_role].filter(Boolean).join(' · ');

    $('#friendProfileHeader').innerHTML = `
      <div class="friend-profile-avatar" style="${avatarStyle}">${friend.avatar ? '' : initials}</div>
      <div class="friend-profile-name">${esc(friend.name)}</div>
      ${roles ? `<div class="friend-profile-role">${esc(roles)}</div>` : ''}
    `;

    // Tools tab
    const toolsTab = $('#friendToolsTab');
    if (fTools.length === 0) {
      toolsTab.innerHTML = '<p style="color:var(--text-secondary);text-align:center;padding:20px">No tools yet.</p>';
    } else {
      toolsTab.innerHTML = `<div class="friend-tools-grid">${fTools.map(t => {
        const domain = t.url ? t.url.replace(/^https?:\/\//, '').replace(/\/.*$/, '') : '';
        const faviconHtml = domain
          ? `<img class="friend-tool-favicon" src="https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=64" alt="" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'">`
          : '';
        const initials2 = t.name.split(/\s+/).map(w => w[0]).join('').slice(0, 2).toUpperCase();
        const fallback = `<div class="friend-tool-favicon-fallback" ${domain ? 'style="display:none"' : ''}>${esc(initials2)}</div>`;
        return `
          <div class="friend-tool-card">
            ${faviconHtml}${fallback}
            <div class="friend-tool-info">
              <div class="friend-tool-name">${esc(t.name)}</div>
              ${t.description ? `<div class="friend-tool-desc">${esc(t.description)}</div>` : ''}
              <div class="friend-tool-meta">
                <span class="friend-tool-badge">${esc(t.category)}</span>
                <span class="friend-tool-badge">${esc(t.pricing)}</span>
              </div>
            </div>
            <button class="friend-tool-add" data-tool='${JSON.stringify({ name: t.name, url: t.url, category: t.category, pricing: t.pricing, description: t.description, notes: t.notes || '' }).replace(/'/g, '&#39;')}' title="Add to My Dock">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
            </button>
          </div>`;
      }).join('')}</div>`;

      // Add tool click handlers
      toolsTab.querySelectorAll('.friend-tool-add').forEach(btn => {
        btn.addEventListener('click', async (e) => {
          e.stopPropagation();
          if (btn.classList.contains('added')) return;
          try {
            const toolData = JSON.parse(btn.dataset.tool);
            await api('/api/tools', { method: 'POST', body: JSON.stringify(toolData) });
            btn.classList.add('added');
            btn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>';
            // Refresh my tools in background
            const td = await api('/api/tools');
            tools = td.tools || [];
          } catch (err) {
            if (err.message.includes('already')) {
              btn.classList.add('added');
              btn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>';
            } else if (err.message.includes('limit')) {
              alert('Tool limit reached! Get Pro or invite friends for more slots.');
            } else {
              alert(err.message);
            }
          }
        });
      });
    }

    // Stacks tab
    const stacksTab = $('#friendStacksTab');
    if (fStacks.length === 0) {
      stacksTab.innerHTML = '<p style="color:var(--text-secondary);text-align:center;padding:20px">No shared stacks yet.</p>';
    } else {
      stacksTab.innerHTML = `<div class="friend-stacks-grid">${fStacks.map(s => `
        <div class="friend-stack-card" data-slug="${s.share_slug}" style="cursor:pointer">
          <div class="friend-stack-top">
            <span class="friend-stack-icon">${s.icon || '📂'}</span>
            <span class="friend-stack-name">${esc(s.name)}</span>
          </div>
          ${s.description ? `<div class="friend-stack-desc">${esc(s.description)}</div>` : ''}
          <div class="friend-stack-footer">
            <span class="friend-stack-stat">${s.tools ? s.tools.length : 0} tools · ${s.views || 0} views</span>
            <button class="friend-stack-clone" data-slug="${s.share_slug}">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
              Clone
            </button>
          </div>
        </div>`).join('')}</div>`;

      // Stack card click to open shared page
      stacksTab.querySelectorAll('.friend-stack-card').forEach(card => {
        card.addEventListener('click', () => {
          const slug = card.dataset.slug;
          if (slug) window.open(`/stack/${slug}`, '_blank');
        });
      });

      // Clone handlers
      stacksTab.querySelectorAll('.friend-stack-clone').forEach(btn => {
        btn.addEventListener('click', async (e) => {
          e.stopPropagation();
          if (btn.classList.contains('cloned')) return;
          try {
            const slug = btn.dataset.slug;
            const data = await api('/api/stacks/clone/' + slug, { method: 'POST' });
            btn.classList.add('cloned');
            btn.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg> Cloned';
            // Refresh my data in background
            const td = await api('/api/tools');
            tools = td.tools || [];
            const sd = await api('/api/stacks');
            stacks = sd.stacks || [];
            if (data.skipped > 0) {
              alert(`Stack cloned! ${data.skipped} tool(s) skipped due to your tool limit.`);
            }
          } catch (err) {
            alert(err.message || 'Clone failed.');
          }
        });
      });
    }

    // Tab switching
    friendProfileOverlay.querySelectorAll('.friend-tab').forEach(tab => {
      tab.onclick = () => {
        friendProfileOverlay.querySelectorAll('.friend-tab').forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        const tabName = tab.dataset.tab;
        moveFriendTabSlider(tab);
        $('#friendToolsTab').style.display = tabName === 'tools' ? '' : 'none';
        $('#friendStacksTab').style.display = tabName === 'stacks' ? '' : 'none';
      };
    });

    // Position slider on initial tab (use setTimeout to ensure DOM is rendered)
    const activeTab = friendProfileOverlay.querySelector('.friend-tab.active');
    const slider = document.querySelector('.friend-tab-slider');
    if (slider) slider.classList.remove('ready');
    setTimeout(() => {
      if (activeTab) moveFriendTabSlider(activeTab, true);
    }, 20);
  }

  // Back button
  $('#friendProfileBack').addEventListener('click', () => {
    // Reset tabs before navigating
    friendProfileOverlay.querySelectorAll('.friend-tab').forEach(t => t.classList.remove('active'));
    friendProfileOverlay.querySelector('.friend-tab[data-tab="tools"]').classList.add('active');
    const slider = document.querySelector('.friend-tab-slider');
    if (slider) slider.classList.remove('ready');
    $('#friendToolsTab').style.display = '';
    $('#friendStacksTab').style.display = 'none';
    // Navigate back to social view
    router.navigate('/dashboard/social');
  });

  /* ===== Init ===== */
  init();
})();
