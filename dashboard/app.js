(() => {
  'use strict';

  /* ===== Storage ===== */
  const STORAGE_KEY = 'aidock_tools';
  const USER_KEY = 'aidock_user';

  function loadTools() {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY)) || []; }
    catch { return []; }
  }
  function saveTools(list) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
    const email = localStorage.getItem('aidock_email');
    if (email) localStorage.setItem('aidock_tools_' + email, JSON.stringify(list));
  }
  function getUser() { return localStorage.getItem(USER_KEY) || ''; }
  function setUser(name) { localStorage.setItem(USER_KEY, name); }

  const ACCOUNTS_KEY = 'aidock_accounts';
  function loadAccounts() {
    try { return JSON.parse(localStorage.getItem(ACCOUNTS_KEY)) || {}; }
    catch { return {}; }
  }
  function saveAccounts(accs) { localStorage.setItem(ACCOUNTS_KEY, JSON.stringify(accs)); }

  // Simple hash for local password storage (not server-grade, but avoids plaintext)
  async function hashPassword(pw) {
    const data = new TextEncoder().encode(pw);
    const buf = await crypto.subtle.digest('SHA-256', data);
    return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
  }

  let tools = loadTools();

  /* ===== Welcome / Onboarding ===== */
  const welcomeOverlay = document.querySelector('#welcomeOverlay');
  const welcomeForm    = document.querySelector('#welcomeForm');
  const signupView     = document.querySelector('#signupView');
  const loginView      = document.querySelector('#loginView');
  let isLoginMode = false;

  function showWelcome() { welcomeOverlay.classList.add('open'); }
  function hideWelcome() { welcomeOverlay.classList.remove('open'); }

  if (!getUser()) {
    showWelcome();
  }

  // Toggle signup / login views
  document.querySelector('#showLogin')?.addEventListener('click', (e) => {
    e.preventDefault();
    isLoginMode = true;
    signupView.style.display = 'none';
    loginView.style.display = 'block';
  });
  document.querySelector('#showSignup')?.addEventListener('click', (e) => {
    e.preventDefault();
    isLoginMode = false;
    loginView.style.display = 'none';
    signupView.style.display = 'block';
  });

  welcomeForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const accounts = loadAccounts();

    if (isLoginMode) {
      const email = document.querySelector('#loginEmail').value.trim().toLowerCase();
      const pw    = document.querySelector('#loginPassword').value;
      if (!email || !pw) return;
      const hash = await hashPassword(pw);
      const acc = accounts[email];
      if (!acc || acc.hash !== hash) {
        alert('Invalid email or password.');
        return;
      }
      setUser(acc.name);
      // Restore user's tools
      const userToolsKey = 'aidock_tools_' + email;
      const saved = localStorage.getItem(userToolsKey);
      if (saved) {
        tools = JSON.parse(saved);
        saveTools(tools);
      }
      localStorage.setItem('aidock_email', email);
    } else {
      const name  = document.querySelector('#welcomeName').value.trim();
      const email = document.querySelector('#welcomeEmail').value.trim().toLowerCase();
      const pw    = document.querySelector('#welcomePassword').value;
      if (!name || !email || !pw) return;
      if (accounts[email]) {
        alert('An account with this email already exists. Please log in.');
        return;
      }
      const hash = await hashPassword(pw);
      accounts[email] = { name, hash };
      saveAccounts(accounts);
      setUser(name);
      localStorage.setItem('aidock_email', email);
    }

    hideWelcome();
    updateGreeting();
    updateAvatar();
    render();
  });

  /* ===== DOM refs ===== */
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

  /* ===== Greeting & Avatar ===== */
  function getTimeGreeting() {
    const h = new Date().getHours();
    if (h < 12) return { text: 'Good Morning', emoji: '☀️' };
    if (h < 17) return { text: 'Good Afternoon', emoji: '🌤️' };
    if (h < 21) return { text: 'Good Evening', emoji: '🌇' };
    return { text: 'Good Night', emoji: '🌙' };
  }

  function updateGreeting() {
    const name = getUser();
    const { text, emoji } = getTimeGreeting();
    const greetEl = $('#greetingText');
    const subEl = $('#greetingSub');
    if (greetEl) {
      greetEl.innerHTML = `${text}, ${escapeHtml(name)} <span class="wave">${emoji}</span>`;
    }
    if (subEl) {
      const count = tools.length;
      const toolWord = count === 1 ? 'tool' : 'tools';
      subEl.innerHTML = count > 0
        ? `Your AI tool vault holds <strong>${count}</strong> ${toolWord} \u2014 keep discovering!`
        : `Your AI tool vault is empty \u2014 start adding tools! \ud83d\ude80`;
    }
  }

  function updateAvatar() {
    const name = getUser();
    const el = $('#userAvatar');
    if (el && name) {
      const initials = name.split(/\s+/).map(w => w[0]).join('').slice(0, 2);
      el.textContent = initials;
      el.title = name;
    }
  }

  /* ===== Category helpers ===== */
  const CATEGORIES = [
    'Coding & Development','Audio','Video & Images','Writing & Content',
    'Workflow Automation','Research & Analysis','Design & UI',
    'Chatbots & Assistants','Data & Analytics','Other'
  ];

  const catClassMap = {
    'Coding & Development': 'cat-coding',
    'Audio': 'cat-audio',
    'Video & Images': 'cat-video',
    'Writing & Content': 'cat-writing',
    'Workflow Automation': 'cat-workflow',
    'Research & Analysis': 'cat-research',
    'Design & UI': 'cat-design',
    'Chatbots & Assistants': 'cat-chatbots',
    'Data & Analytics': 'cat-data',
    'Other': 'cat-other',
  };

  const catIconMap = {
    'Coding & Development': '💻',
    'Audio': '🎵',
    'Video & Images': '🎬',
    'Writing & Content': '✍️',
    'Workflow Automation': '⚙️',
    'Research & Analysis': '🔬',
    'Design & UI': '🎨',
    'Chatbots & Assistants': '🤖',
    'Data & Analytics': '📊',
    'Other': '📦',
  };

  /* ===== Render category filter chips ===== */
  function renderCategoryFilters() {
    const used = new Set(tools.map(t => t.category));
    const cats = CATEGORIES.filter(c => used.has(c));
    const allCount = tools.length;
    categoryFiltersEl.innerHTML =
      `<button class="sidebar-item ${activeCategory === 'All' ? 'active' : ''}" data-filter="All">
        <span class="sidebar-icon">📁</span> All Tools <span style="margin-left:auto;font-size:11px;opacity:0.5">${allCount}</span>
      </button>` +
      cats.map(c => {
        const count = tools.filter(t => t.category === c).length;
        return `<button class="sidebar-item ${activeCategory === c ? 'active' : ''}" data-filter="${c}">
          <span class="sidebar-icon">${catIconMap[c] || '📦'}</span> ${c} <span style="margin-left:auto;font-size:11px;opacity:0.5">${count}</span>
        </button>`;
      }).join('');
  }

  /* ===== Render cards ===== */
  function render() {
    renderCategoryFilters();
    updateGreeting();
    const filtered = tools.filter(t => {
      if (activeCategory !== 'All' && t.category !== activeCategory) return false;
      if (activePricing !== 'All' && t.pricing !== activePricing) return false;
      if (searchQuery) {
        const q = searchQuery.toLowerCase();
        return t.name.toLowerCase().includes(q) ||
               (t.description || '').toLowerCase().includes(q) ||
               (t.notes || '').toLowerCase().includes(q) ||
               t.category.toLowerCase().includes(q);
      }
      return true;
    });

    emptyState.style.display = filtered.length === 0 ? 'flex' : 'none';
    cardsGrid.style.display  = filtered.length === 0 ? 'none' : 'grid';

    cardsGrid.innerHTML = filtered.map((t, i) => {
      const initials = t.name.slice(0, 2);
      const catClass = catClassMap[t.category] || 'cat-other';
      const linkHtml = t.url
        ? `<a class="card-link" href="${escapeHtml(t.url)}" target="_blank" rel="noopener noreferrer">Visit ↗</a>`
        : '';
      const notesHtml = t.notes
        ? `<div class="card-notes">${escapeHtml(t.notes)}</div>`
        : '';
      const descHtml = t.description
        ? `<div class="card-desc">${escapeHtml(t.description)}</div>`
        : '';

      return `
        <div class="card" style="animation-delay:${i * 40}ms" data-id="${t.id}">
          <div class="card-top">
            <div class="card-identity">
              <div class="card-avatar ${catClass}">${escapeHtml(initials)}</div>
              <div class="card-name" title="${escapeHtml(t.name)}">${escapeHtml(t.name)}</div>
            </div>
            <div class="card-actions">
              <button title="Edit" data-edit="${t.id}">✏️</button>
              <button title="Delete" data-delete="${t.id}">🗑</button>
            </div>
          </div>
          <div class="card-badges">
            <span class="badge badge-category">${catIconMap[t.category] || '📦'} ${escapeHtml(t.category)}</span>
            <span class="badge badge-pricing" data-pricing="${t.pricing}">${t.pricing}</span>
          </div>
          ${descHtml}
          ${notesHtml}
          ${linkHtml}
        </div>`;
    }).join('');
  }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str || '';
    return div.innerHTML;
  }

  /* ===== Modal open/close ===== */
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

  /* ===== Save ===== */
  toolForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const id = $('#editId').value;
    const data = {
      id: id || crypto.randomUUID(),
      name: $('#toolName').value.trim(),
      url: $('#toolUrl').value.trim(),
      pricing: $('#toolPricing').value,
      category: $('#toolCategory').value,
      description: $('#toolDescription').value.trim(),
      notes: $('#toolNotes').value.trim(),
      createdAt: id ? (tools.find(t => t.id === id)?.createdAt || Date.now()) : Date.now(),
    };
    if (!data.name) return;
    if (id) {
      tools = tools.map(t => t.id === id ? data : t);
    } else {
      tools.push(data);
    }
    saveTools(tools);
    closeModal();
    render();
  });

  /* ===== Delete ===== */
  $('#deleteConfirmBtn').addEventListener('click', () => {
    if (!deleteTargetId) return;
    tools = tools.filter(t => t.id !== deleteTargetId);
    saveTools(tools);
    closeDelete();
    render();
  });

  /* ===== Auto-detect description ===== */

  // Multiple CORS proxies as fallbacks
  const PROXIES = [
    (u) => `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(u)}`,
    (u) => `https://corsproxy.io/?${encodeURIComponent(u)}`,
    (u) => `https://api.allorigins.win/raw?url=${encodeURIComponent(u)}`,
    (u) => `https://cors-anywhere.herokuapp.com/${u}`,
  ];

  async function fetchViaProxies(url) {
    for (const proxyFn of PROXIES) {
      try {
        const proxyUrl = proxyFn(url);
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 8000);
        const resp = await fetch(proxyUrl, {
          signal: controller.signal,
          headers: { 'Accept': 'text/html' },
        });
        clearTimeout(timeout);
        if (!resp.ok) continue;
        const text = await resp.text();
        if (text && text.length > 50) return text;
      } catch { /* try next proxy */ }
    }
    return null;
  }

  function extractDescription(html) {
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');

    // Priority list of selectors for description
    const selectors = [
      'meta[property="og:description"]',
      'meta[name="description"]',
      'meta[name="Description"]',
      'meta[property="twitter:description"]',
      'meta[name="twitter:description"]',
      'meta[itemprop="description"]',
    ];

    for (const sel of selectors) {
      const el = doc.querySelector(sel);
      const val = el?.getAttribute('content')?.trim();
      if (val && val.length > 10) return val.slice(0, 300);
    }

    // Fallback: try ld+json structured data
    const ldScripts = doc.querySelectorAll('script[type="application/ld+json"]');
    for (const script of ldScripts) {
      try {
        const data = JSON.parse(script.textContent);
        const desc = data.description || data?.mainEntity?.description;
        if (desc && desc.length > 10) return desc.trim().slice(0, 300);
      } catch { /* skip */ }
    }

    // Fallback: first meaningful <p> tag
    const paragraphs = doc.querySelectorAll('p');
    for (const p of paragraphs) {
      const text = p.textContent?.trim();
      if (text && text.length > 30) return text.slice(0, 300);
    }

    // Fallback: <h1> + subtitle approach
    const h1 = doc.querySelector('h1');
    if (h1) {
      const text = h1.textContent?.trim();
      if (text && text.length > 10) return text.slice(0, 300);
    }

    return '';
  }

  $('#fetchDescBtn').addEventListener('click', async () => {
    const url = $('#toolUrl').value.trim();
    if (!url) { alert('Enter a URL first.'); return; }
    const btn = $('#fetchDescBtn');
    btn.textContent = '⏳ Fetching…';
    btn.disabled = true;
    try {
      const html = await fetchViaProxies(url);
      if (!html) {
        alert('All proxies failed. Please add a description manually.');
        return;
      }
      const desc = extractDescription(html);
      if (desc) {
        $('#toolDescription').value = desc;
      } else {
        alert('Could not find a description on that page. Add one manually.');
      }
    } catch {
      alert('Failed to fetch. Please add a description manually.');
    } finally {
      btn.textContent = 'Auto-detect description';
      btn.disabled = false;
    }
  });

  /* ===== Export CSV ===== */
  function escapeCsvField(val) {
    const s = String(val ?? '');
    if (s.includes(',') || s.includes('"') || s.includes('\n')) {
      return '"' + s.replace(/"/g, '""') + '"';
    }
    return s;
  }

  $('#exportBtn').addEventListener('click', () => {
    if (tools.length === 0) { alert('Nothing to export.'); return; }
    const headers = ['name', 'url', 'category', 'pricing', 'description', 'notes'];
    const rows = [headers.join(',')];
    for (const t of tools) {
      rows.push(headers.map(h => escapeCsvField(t[h])).join(','));
    }
    const blob = new Blob([rows.join('\n')], { type: 'text/csv;charset=utf-8;' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `aidock-tools-${new Date().toISOString().slice(0,10)}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  });

  /* ===== Import CSV ===== */
  function parseCsvLine(line) {
    const result = [];
    let current = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (inQuotes) {
        if (ch === '"' && line[i + 1] === '"') { current += '"'; i++; }
        else if (ch === '"') { inQuotes = false; }
        else { current += ch; }
      } else {
        if (ch === '"') { inQuotes = true; }
        else if (ch === ',') { result.push(current); current = ''; }
        else { current += ch; }
      }
    }
    result.push(current);
    return result;
  }

  $('#importBtn').addEventListener('click', () => $('#importFile').click());
  $('#importFile').addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = ev.target.result;
      const lines = text.split(/\r?\n/).filter(l => l.trim());
      if (lines.length < 2) { alert('CSV is empty or has no data rows.'); return; }

      const headers = parseCsvLine(lines[0]).map(h => h.trim().toLowerCase());
      const nameIdx = headers.indexOf('name');
      if (nameIdx === -1) { alert('CSV must have a "name" column.'); return; }

      const map = { url: 'url', category: 'category', pricing: 'pricing', description: 'description', notes: 'notes' };
      let imported = 0;

      for (let i = 1; i < lines.length; i++) {
        const cols = parseCsvLine(lines[i]);
        const name = (cols[nameIdx] || '').trim();
        if (!name) continue;

        const tool = {
          id: crypto.randomUUID(),
          name,
          url: '',
          category: 'Other',
          pricing: 'Unknown',
          description: '',
          notes: '',
          createdAt: Date.now(),
        };

        for (const [key, field] of Object.entries(map)) {
          const idx = headers.indexOf(key);
          if (idx !== -1 && cols[idx]) tool[field] = cols[idx].trim();
        }

        // Validate category & pricing
        if (!CATEGORIES.includes(tool.category)) tool.category = 'Other';
        if (!['Free', 'Freemium', 'Paid', 'Unknown'].includes(tool.pricing)) tool.pricing = 'Unknown';

        tools.push(tool);
        imported++;
      }

      saveTools(tools);
      render();
      alert(`Imported ${imported} tool(s).`);
    };
    reader.readAsText(file);
    e.target.value = '';
  });

  /* ===== Events ===== */
  // User menu
  $('#userAvatar').addEventListener('click', (e) => {
    e.stopPropagation();
    const dd = $('#userDropdown');
    dd.classList.toggle('open');
    $('#userDropdownName').textContent = getUser();
    $('#userDropdownEmail').textContent = localStorage.getItem('aidock_email') || '';
  });
  document.addEventListener('click', () => $('#userDropdown').classList.remove('open'));

  $('#logoutBtn').addEventListener('click', () => {
    localStorage.removeItem(USER_KEY);
    localStorage.removeItem('aidock_email');
    localStorage.removeItem(STORAGE_KEY);
    location.reload();
  });

  // Add button
  $('#addToolBtn').addEventListener('click', () => openModal());
  $('#emptyAddBtn').addEventListener('click', () => openModal());

  // Close modals
  $('#modalClose').addEventListener('click', closeModal);
  $('#cancelBtn').addEventListener('click', closeModal);
  $('#deleteClose').addEventListener('click', closeDelete);
  $('#deleteCancelBtn').addEventListener('click', closeDelete);
  modalOverlay.addEventListener('click', (e) => { if (e.target === modalOverlay) closeModal(); });
  deleteOverlay.addEventListener('click', (e) => { if (e.target === deleteOverlay) closeDelete(); });

  // Card actions (delegate)
  cardsGrid.addEventListener('click', (e) => {
    const editBtn = e.target.closest('[data-edit]');
    const delBtn  = e.target.closest('[data-delete]');
    if (editBtn) {
      const t = tools.find(x => x.id === editBtn.dataset.edit);
      if (t) openModal(t);
    }
    if (delBtn) openDelete(delBtn.dataset.delete);
  });

  // Search
  searchInput.addEventListener('input', (e) => {
    searchQuery = e.target.value;
    render();
  });

  // Category filters (delegate)
  categoryFiltersEl.addEventListener('click', (e) => {
    const item = e.target.closest('.sidebar-item');
    if (!item) return;
    activeCategory = item.dataset.filter;
    render();
  });

  // Pricing filters (delegate)
  pricingFiltersEl.addEventListener('click', (e) => {
    const item = e.target.closest('.sidebar-item');
    if (!item) return;
    pricingFiltersEl.querySelectorAll('.sidebar-item').forEach(c => c.classList.remove('active'));
    item.classList.add('active');
    activePricing = item.dataset.pricing;
    render();
  });

  // Keyboard shortcut: Escape to close modals, Cmd/Ctrl+K to focus search
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { closeModal(); closeDelete(); }
    if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
      e.preventDefault();
      searchInput.focus();
    }
  });

  /* ===== Init ===== */
  render();
  updateAvatar();
})();
