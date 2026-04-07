(() => {
  'use strict';

  // Capture URL parameters
  const urlParams = new URLSearchParams(window.location.search);
  const refCode = urlParams.get('ref') || '';
  const redirectUrl = urlParams.get('redirect') || '/dashboard';

  // Check if already logged in
  fetch('/api/auth/me').then(r => { if (r.ok) window.location.href = redirectUrl; });

  const signupView = document.getElementById('signupView');
  const loginView  = document.getElementById('loginView');

  document.getElementById('showLogin').addEventListener('click', (e) => {
    e.preventDefault();
    signupView.style.display = 'none';
    loginView.style.display = 'block';
  });
  document.getElementById('showSignup').addEventListener('click', (e) => {
    e.preventDefault();
    loginView.style.display = 'none';
    signupView.style.display = 'block';
  });

  // Avatar upload preview
  let avatarDataUrl = '';
  const avatarUpload = document.getElementById('avatarUpload');
  const avatarInput = document.getElementById('signupAvatar');
  const avatarPreview = document.getElementById('avatarPreview');
  avatarUpload.addEventListener('click', () => avatarInput.click());
  avatarInput.addEventListener('change', () => {
    const file = avatarInput.files[0];
    if (!file) return;
    if (file.size > 1.5 * 1024 * 1024) { alert('Image too large. Max 1.5MB.'); return; }
    const reader = new FileReader();
    reader.onload = (ev) => {
      avatarDataUrl = ev.target.result;
      avatarPreview.innerHTML = '';
      avatarPreview.style.backgroundImage = `url(${avatarDataUrl})`;
      avatarPreview.style.backgroundSize = 'cover';
      avatarPreview.style.backgroundPosition = 'center';
    };
    reader.readAsDataURL(file);
  });

  // Signup
  document.getElementById('signupForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const errEl = document.getElementById('signupError');
    const btn = e.target.querySelector('button[type="submit"]');
    const originalText = btn.textContent;
    errEl.textContent = '';
    
    const name     = document.getElementById('signupName').value.trim();
    const email    = document.getElementById('signupEmail').value.trim();
    const password = document.getElementById('signupPassword').value;
    const primary_role = document.getElementById('signupPrimaryRole').value;
    const secondary_role = document.getElementById('signupSecondaryRole').value;

    // Show loading state
    btn.disabled = true;
    btn.textContent = 'Creating account...';

    try {
      const res = await fetch('/api/auth/signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, email, password, primary_role, secondary_role, invite_code: refCode }),
      });
      const data = await res.json();
      if (!res.ok) { 
        errEl.textContent = data.error || 'Signup failed.'; 
        btn.disabled = false;
        btn.textContent = originalText;
        return; 
      }

      // Upload avatar if selected
      if (avatarDataUrl) {
        btn.textContent = 'Uploading avatar...';
        await fetch('/api/auth/avatar', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ avatar: avatarDataUrl }),
        });
      }

      btn.textContent = 'Success! Redirecting...';
      window.location.href = redirectUrl;
    } catch { 
      errEl.textContent = 'Network error. Please try again.'; 
      btn.disabled = false;
      btn.textContent = originalText;
    }
  });

  // Login
  document.getElementById('loginForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const errEl = document.getElementById('loginError');
    const btn = e.target.querySelector('button[type="submit"]');
    const originalText = btn.textContent;
    errEl.textContent = '';
    
    const email    = document.getElementById('loginEmail').value.trim();
    const password = document.getElementById('loginPassword').value;

    // Show loading state
    btn.disabled = true;
    btn.textContent = 'Signing in...';

    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      const data = await res.json();
      if (!res.ok) { 
        errEl.textContent = data.error || 'Login failed.'; 
        btn.disabled = false;
        btn.textContent = originalText;
        return; 
      }
      btn.textContent = 'Success! Redirecting...';
      window.location.href = redirectUrl;
    } catch { 
      errEl.textContent = 'Network error. Please try again.'; 
      btn.disabled = false;
      btn.textContent = originalText;
    }
  });
})();
