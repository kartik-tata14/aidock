(() => {
  'use strict';

  // --- Config ---
  // For local development: 'http://localhost:3000'
  // For production: Change to your Vercel URL, e.g., 'https://aidock.vercel.app'
  const API_BASE = 'http://localhost:3000';

  // --- DOM refs ---
  const authView       = document.getElementById('authView');
  const toolView       = document.getElementById('toolView');
  const loginForm      = document.getElementById('loginForm');
  const toolForm       = document.getElementById('toolForm');
  const authError      = document.getElementById('authError');
  const toolError      = document.getElementById('toolError');
  const toolSuccess    = document.getElementById('toolSuccess');
  const loginBtn       = document.getElementById('loginBtn');
  const saveBtn        = document.getElementById('saveBtn');
  const detectBtn      = document.getElementById('detectBtn');
  const logoutBtn      = document.getElementById('logoutBtn');
  const openSignup     = document.getElementById('openSignup');
  const openDashboard  = document.getElementById('openDashboard');
  const userNameEl     = document.getElementById('userName');
  const userAvatarEl   = document.getElementById('userAvatar');
  const slotsIndicator = document.getElementById('slotsIndicator');
  const slotsFill      = document.getElementById('slotsFill');
  const slotsText      = document.getElementById('slotsText');
  const recentSection  = document.getElementById('recentSection');
  const recentList     = document.getElementById('recentList');
  const toggleRecent   = document.getElementById('toggleRecent');

  // --- State ---
  let currentUser = null;
  let userTools = [];

  // --- API helper ---
  async function api(url, opts = {}) {
    const token = (await chrome.storage.local.get('aidock_token')).aidock_token;
    opts.headers = {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...opts.headers,
    };
    const res = await fetch(API_BASE + url, opts);
    const data = await res.json();
    if (!res.ok) {
      const err = new Error(data.error || 'Request failed');
      err.status = res.status;
      throw err;
    }
    return data;
  }

  // --- Show / hide views ---
  function showAuth() {
    authView.style.display = '';
    toolView.style.display = 'none';
  }

  function showTool(user) {
    authView.style.display = 'none';
    toolView.style.display = '';
    currentUser = user;
    
    // Update user info
    userNameEl.textContent = user.name;
    userAvatarEl.textContent = user.name.charAt(0).toUpperCase();
    
    // Update slots indicator
    updateSlotsIndicator();
    
    // Fetch and show recent tools
    fetchRecentTools();
  }

  // --- Update slots indicator ---
  function updateSlotsIndicator() {
    if (!currentUser) return;
    
    const used = userTools.length;
    const limit = currentUser.tool_limit || 10;
    const percent = Math.min((used / limit) * 100, 100);
    
    slotsFill.style.width = percent + '%';
    slotsText.textContent = `${used} / ${limit} slots`;
    
    // Color coding
    slotsFill.classList.remove('warning', 'full');
    if (percent >= 100) {
      slotsFill.classList.add('full');
    } else if (percent >= 80) {
      slotsFill.classList.add('warning');
    }
  }

  // --- Fetch recent tools ---
  async function fetchRecentTools() {
    try {
      const data = await api('/api/tools');
      userTools = data.tools || [];
      
      // Update slots after fetching tools
      updateSlotsIndicator();
      
      // Show recently added (last 3)
      const recent = userTools
        .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
        .slice(0, 3);
      
      if (recent.length > 0) {
        recentSection.style.display = '';
        recentList.innerHTML = recent.map(tool => {
          const favicon = tool.url ? 
            `<img src="https://www.google.com/s2/favicons?domain=${new URL(tool.url).hostname}&sz=32" onerror="this.style.display='none'; this.parentElement.innerHTML='📦'">` :
            '📦';
          const timeAgo = getTimeAgo(new Date(tool.created_at));
          return `
            <a href="${tool.url || '#'}" class="recent-item" target="_blank" rel="noopener">
              <div class="recent-favicon">${favicon}</div>
              <div class="recent-info">
                <div class="recent-name">${escapeHtml(tool.name)}</div>
                <div class="recent-category">${tool.category || 'Other'}</div>
              </div>
              <span class="recent-time">${timeAgo}</span>
            </a>
          `;
        }).join('');
      } else {
        recentSection.style.display = 'none';
      }
    } catch (err) {
      console.error('Failed to fetch recent tools:', err);
      recentSection.style.display = 'none';
    }
  }

  // --- Time ago helper ---
  function getTimeAgo(date) {
    const now = new Date();
    const diff = now - date;
    const mins = Math.floor(diff / 60000);
    const hours = Math.floor(diff / 3600000);
    const days = Math.floor(diff / 86400000);
    
    if (mins < 1) return 'Just now';
    if (mins < 60) return `${mins}m ago`;
    if (hours < 24) return `${hours}h ago`;
    if (days < 7) return `${days}d ago`;
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }

  // --- HTML escape helper ---
  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  // --- Toggle recent section ---
  toggleRecent.addEventListener('click', () => {
    toggleRecent.classList.toggle('collapsed');
    recentList.classList.toggle('collapsed');
  });

  // --- Init: check if already signed in ---
  async function init() {
    try {
      const data = await api('/api/auth/me');
      showTool(data.user);
      prefillFromTab();
    } catch {
      showAuth();
    }
  }

  // --- Extract meta description directly from the tab (no server needed) ---
  async function extractFromTab(tabId) {
    try {
      const results = await chrome.scripting.executeScript({
        target: { tabId },
        func: () => {
          const og = document.querySelector('meta[property="og:description"]');
          const meta = document.querySelector('meta[name="description"]');
          const tw = document.querySelector('meta[name="twitter:description"]');
          return (og && og.content) || (meta && meta.content) || (tw && tw.content) || '';
        },
      });
      return results?.[0]?.result || '';
    } catch { return ''; }
  }

  // --- Pre-fill URL and name from current tab, then auto-detect ---
  async function prefillFromTab() {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab && tab.url) {
        document.getElementById('toolUrl').value = tab.url;
        const title = (tab.title || '').replace(/ [-\u2013\u2014|].*/g, '').trim();
        if (title) document.getElementById('toolName').value = title;
        // Auto-detect description + category
        autoDetect(tab.url, tab.id);
      }
    } catch { /* no tab access */ }
  }

  // --- Auto-detect description + category ---
  async function autoDetect(url, tabId) {
    if (!url) return;
    detectBtn.textContent = '⏳ Detecting…';
    detectBtn.disabled = true;
    toolError.textContent = '';
    let gotDesc = false;
    
    // Try server-side first
    try {
      const data = await api('/api/fetch-description?url=' + encodeURIComponent(url));
      if (data.description) {
        document.getElementById('toolDescription').value = data.description;
        gotDesc = true;
      }
      if (data.suggestedCategory) {
        document.getElementById('toolCategory').value = data.suggestedCategory;
      }
    } catch {
      // Server fetch failed — try extracting from the tab directly
    }

    // Fallback: extract meta description from the active tab's DOM
    if (!gotDesc && tabId) {
      try {
        const tabDesc = await extractFromTab(tabId);
        if (tabDesc && tabDesc.length > 10) {
          document.getElementById('toolDescription').value = tabDesc.trim().slice(0, 300);
          gotDesc = true;
        }
      } catch { /* ignore */ }
    }

    if (!gotDesc) {
      toolError.textContent = 'Could not auto-detect description. You can type it manually.';
    }

    detectBtn.textContent = '⚡ Auto-detect';
    detectBtn.disabled = false;
  }

  // --- Login ---
  loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    authError.textContent = '';
    loginBtn.classList.add('loading');
    loginBtn.disabled = true;
    try {
      const email = document.getElementById('email').value.trim();
      const password = document.getElementById('password').value;
      const data = await api('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email, password }),
      });
      // Store the token from the response
      if (data.token) {
        await chrome.storage.local.set({ aidock_token: data.token });
      }
      showTool(data.user);
      prefillFromTab();
    } catch (err) {
      authError.textContent = err.message;
    } finally {
      loginBtn.classList.remove('loading');
      loginBtn.disabled = false;
    }
  });

  // --- Logout ---
  logoutBtn.addEventListener('click', async () => {
    await chrome.storage.local.remove('aidock_token');
    currentUser = null;
    userTools = [];
    showAuth();
  });

  // --- Open signup in new tab ---
  openSignup.addEventListener('click', (e) => {
    e.preventDefault();
    chrome.tabs.create({ url: API_BASE + '/auth' });
  });

  // --- Open dashboard in new tab ---
  openDashboard.addEventListener('click', (e) => {
    e.preventDefault();
    chrome.tabs.create({ url: API_BASE + '/dashboard' });
  });

  // --- Auto-detect button (manual trigger) ---
  detectBtn.addEventListener('click', async () => {
    const url = document.getElementById('toolUrl').value.trim();
    if (!url) return;
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      await autoDetect(url, tab?.id);
    } catch {
      await autoDetect(url);
    }
  });

  // --- Save tool ---
  toolForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    toolError.textContent = '';
    toolSuccess.style.display = 'none';
    saveBtn.classList.add('loading');
    saveBtn.disabled = true;
    try {
      const body = {
        name: document.getElementById('toolName').value.trim(),
        url: document.getElementById('toolUrl').value.trim(),
        category: document.getElementById('toolCategory').value,
        pricing: document.getElementById('toolPricing').value,
        description: document.getElementById('toolDescription').value.trim(),
        notes: document.getElementById('toolNotes').value.trim(),
      };
      if (!body.name) throw new Error('Name is required');
      await api('/api/tools', { method: 'POST', body: JSON.stringify(body) });
      toolSuccess.style.display = 'flex';
      toolForm.reset();
      
      // Refresh recent tools
      await fetchRecentTools();
      
      // Auto-close after brief delay
      setTimeout(() => window.close(), 1500);
    } catch (err) {
      // Check if limit reached (403 status)
      if (err.status === 403 && err.message.includes('limit')) {
        toolError.innerHTML = `
          <strong>Slot limit reached!</strong><br>
          <span style="font-size:11px; opacity:0.8">Opening dashboard to unlock more slots...</span>
        `;
        // Open dashboard with unlock modal trigger
        setTimeout(() => {
          chrome.tabs.create({ url: API_BASE + '/dashboard?showPaywall=1' });
        }, 1500);
      } else {
        toolError.textContent = err.message;
      }
    } finally {
      saveBtn.classList.remove('loading');
      saveBtn.disabled = false;
    }
  });

  // --- Start ---
  init();
})();
