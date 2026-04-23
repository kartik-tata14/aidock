/**
 * AIDock Onboarding � Guided first-time user experience
 * Fully decoupled from dashboard.js; interacts only via DOM
 */
(() => {
  'use strict';

  const STORAGE_KEY = 'aidock-onboarding-done';

  const $ = s => document.querySelector(s);
  let currentStep = 0;
  let overlay, tooltip;
  let activeClickHandler = null;
  let activeTargetEl = null;
  let resizeRAF = null;

  const STEPS = [
    {
      id: 'welcome',
      target: () => $('#addToolBtn'),
      title: 'Welcome to AIDock! \ud83c\udf89',
      text: 'Let\'s take a quick tour. Click <strong>+ Add Tool</strong> to save your first AI tool \u2014 or use the Chrome extension to save directly from any site.',
      position: 'bottom',
      action: 'click-target',
    },
    {
      id: 'fill-name',
      target: () => $('#toolName'),
      title: 'Tool Name',
      text: 'This is the name of the AI tool. We\'ve pre-filled <strong>Claude</strong> as an example \u2014 the Chrome extension fills this automatically from the site you\'re visiting.',
      position: 'right',
      action: 'next',
      parentElevate: '#modalOverlay',
      onEnter() {
        const name = $('#toolName');
        const url = $('#toolUrl');
        const pricing = $('#toolPricing');
        const category = $('#toolCategory');
        const desc = $('#toolDescription');
        if (name) name.value = 'Claude';
        if (url) url.value = 'https://claude.ai';
        if (pricing) pricing.value = 'Freemium';
        if (category) category.value = 'AI Agents';
        if (desc) desc.value = 'Claude is an AI assistant by Anthropic that helps with analysis, writing, coding, math, and more.';
      },
    },
    {
      id: 'fill-url',
      target: () => $('#toolUrl'),
      title: 'Website URL',
      text: 'The tool\'s website link. The Chrome extension auto-captures this from the page you\'re on.',
      position: 'right',
      action: 'next',
      parentElevate: '#modalOverlay',
    },
    {
      id: 'fill-category',
      target: () => $('#toolCategory'),
      title: 'Category',
      text: 'Choose a category to organise your tools. The extension auto-detects the best category for you.',
      position: 'right',
      action: 'next',
      parentElevate: '#modalOverlay',
    },
    {
      id: 'fill-description',
      target: () => $('#toolDescription'),
      title: 'Description',
      text: 'A short summary of the tool. Leave it empty and AIDock auto-fetches it, or write your own.',
      position: 'right',
      action: 'next',
      parentElevate: '#modalOverlay',
    },
    {
      id: 'save-tool',
      target: () => document.querySelector('#toolForm .btn-primary'),
      title: 'Save Your Tool',
      text: 'All set! Click <strong>Save Tool</strong> to add it to your dock.',
      position: 'top',
      action: 'click-target',
      parentElevate: '#modalOverlay',
    },
    {
      id: 'tool-saved',
      target: () => document.querySelector('.cards-grid .card'),
      title: 'Your First Tool! \ud83c\udfaf',
      text: 'Here it is \u2014 your first saved AI tool. You can edit, delete, or visit the tool from this card.',
      position: 'bottom',
      action: 'next',
      waitFor: () => document.querySelector('.cards-grid .card'),
    },
    {
      id: 'create-stack',
      target: () => $('#createStackBtn'),
      title: 'Create a Stack \ud83d\udcda',
      text: 'Stacks let you group related tools together \u2014 like playlists for your AI toolkit. Click <strong>+ New Stack</strong> to create one.',
      position: 'bottom',
      action: 'click-target',
    },
    {
      id: 'fill-stack-name',
      target: () => $('#stackName'),
      title: 'Name Your Stack',
      text: 'Give your stack a name, like "Writing Tools" or "Dev Toolkit". We\'ve pre-filled an example for you.',
      position: 'right',
      action: 'next',
      parentElevate: '#stackModalOverlay',
      onEnter() {
        const name = $('#stackName');
        const desc = $('#stackDescription');
        if (name) name.value = 'My AI Toolkit';
        if (desc) desc.value = 'My essential AI tools collection';
      },
    },
    {
      id: 'save-stack',
      target: () => document.querySelector('#stackForm .btn-primary'),
      title: 'Save Your Stack',
      text: 'Click <strong>Save Stack</strong> to create it. You can then drag & drop tools into it.',
      position: 'top',
      action: 'click-target',
      parentElevate: '#stackModalOverlay',
    },
    {
      id: 'stack-created',
      target: () => document.querySelector('.stacks-dock .stack-item:not(.stack-item-create)'),
      title: 'Stack Created! \ud83d\uddc2\ufe0f',
      text: 'Your stack is ready! <strong>Drag & drop</strong> tool cards onto a stack to organize them. Click a stack to open, share, or customize it.',
      position: 'bottom',
      action: 'next',
      waitFor: () => document.querySelector('.stacks-dock .stack-item:not(.stack-item-create)'),
    },
    {
      id: 'done',
      target: null,
      title: 'You\'re All Set! \ud83d\ude80',
      text: 'You know the basics! Explore categories in the sidebar, use the Chrome extension to save tools with one click, and share your stacks with friends. Happy docking!',
      position: 'center',
      action: 'finish',
    },
  ];

  // Track elevated parent modals
  let elevatedParent = null;

  function elevateParent(step) {
    restoreParent();
    if (step.parentElevate) {
      const parent = $(step.parentElevate);
      if (parent) {
        elevatedParent = parent;
        parent.classList.add('onb-elevated');
      }
    }
  }

  function restoreParent() {
    if (elevatedParent) {
      elevatedParent.classList.remove('onb-elevated');
      elevatedParent = null;
    }
  }

  // --- Create DOM elements ---
  function createOverlay() {
    overlay = document.createElement('div');
    overlay.className = 'onb-overlay';
    overlay.innerHTML = `
      <svg class="onb-svg" xmlns="http://www.w3.org/2000/svg" width="100%" height="100%">
        <defs>
          <mask id="onb-mask">
            <rect width="100%" height="100%" fill="white"/>
            <rect class="onb-hole" rx="12" ry="12" fill="black"/>
          </mask>
        </defs>
        <rect width="100%" height="100%" fill="rgba(0,0,0,0.6)" mask="url(#onb-mask)"/>
      </svg>`;
    document.body.appendChild(overlay);

    tooltip = document.createElement('div');
    tooltip.className = 'onb-tooltip';
    document.body.appendChild(tooltip);
  }

  function renderTooltip(step, stepIdx) {
    const total = STEPS.length;
    const actionText = step.action === 'finish' ? 'Finish Tour' :
                       step.action === 'click-target' ? '' :
                       'Next \u2192';

    tooltip.innerHTML = `
      <div class="onb-tooltip-header">
        <span class="onb-step-counter">${stepIdx + 1} / ${total}</span>
        <button class="onb-skip">Skip Tour</button>
      </div>
      <h4 class="onb-tooltip-title">${step.title}</h4>
      <p class="onb-tooltip-text">${step.text}</p>
      <div class="onb-footer">
        ${actionText ? `<button class="onb-next-btn">${actionText}</button>` : ''}
        <label class="onb-dont-show"><input type="checkbox" class="onb-dont-show-cb"> Don't show this again</label>
      </div>
    `;

    tooltip.querySelector('.onb-skip').addEventListener('click', endTour);
    const nextBtn = tooltip.querySelector('.onb-next-btn');
    if (nextBtn) nextBtn.addEventListener('click', () => {
      if (step.action === 'finish') endTour();
      else advanceStep();
    });
  }

  // --- Positioning ---
  function reposition() {
    const step = STEPS[currentStep];
    if (!step || !overlay || !tooltip) return;
    const el = step.target ? step.target() : null;
    positionSpotlight(el);
    positionTooltip(step, el);
  }

  function positionSpotlight(el) {
    const hole = overlay.querySelector('.onb-hole');
    if (!el) {
      hole.setAttribute('width', 0);
      hole.setAttribute('height', 0);
      return;
    }
    const r = el.getBoundingClientRect();
    const pad = 8;
    hole.setAttribute('x', r.left - pad);
    hole.setAttribute('y', r.top - pad);
    hole.setAttribute('width', r.width + pad * 2);
    hole.setAttribute('height', r.height + pad * 2);
  }

  function positionTooltip(step, el) {
    tooltip.classList.remove('onb-pos-top', 'onb-pos-bottom', 'onb-pos-left', 'onb-pos-right', 'onb-pos-center');

    if (step.position === 'center' || !el) {
      tooltip.classList.add('onb-pos-center');
      tooltip.style.left = '50%';
      tooltip.style.top = '50%';
      tooltip.style.transform = 'translate(-50%, -50%)';
      return;
    }

    const r = el.getBoundingClientRect();
    const tw = tooltip.offsetWidth;
    const th = tooltip.offsetHeight;
    const gap = 16;
    let left, top;
    let pos = step.position;

    // Auto-flip if not enough room
    if (pos === 'bottom' && r.bottom + gap + th > window.innerHeight) pos = 'top';
    else if (pos === 'top' && r.top - gap - th < 0) pos = 'bottom';
    else if (pos === 'right' && r.right + gap + tw > window.innerWidth) pos = 'left';
    else if (pos === 'left' && r.left - gap - tw < 0) pos = 'right';

    tooltip.classList.add('onb-pos-' + pos);

    switch (pos) {
      case 'bottom':
        left = r.left + r.width / 2 - tw / 2;
        top = r.bottom + gap;
        break;
      case 'top':
        left = r.left + r.width / 2 - tw / 2;
        top = r.top - th - gap;
        break;
      case 'right':
        left = r.right + gap;
        top = r.top + r.height / 2 - th / 2;
        break;
      case 'left':
        left = r.left - tw - gap;
        top = r.top + r.height / 2 - th / 2;
        break;
    }

    left = Math.max(12, Math.min(left, window.innerWidth - tw - 12));
    top = Math.max(12, Math.min(top, window.innerHeight - th - 12));

    tooltip.style.left = left + 'px';
    tooltip.style.top = top + 'px';
    tooltip.style.transform = 'none';
  }

  // --- Resize / scroll handler ---
  function onResizeOrScroll() {
    if (resizeRAF) cancelAnimationFrame(resizeRAF);
    resizeRAF = requestAnimationFrame(reposition);
  }

  // --- Clean up click handler ---
  function cleanupClickHandler() {
    if (activeClickHandler && activeTargetEl) {
      activeTargetEl.removeEventListener('click', activeClickHandler);
    }
    if (activeTargetEl) {
      activeTargetEl.style.zIndex = '';
      activeTargetEl.classList.remove('onb-target-active');
    }
    activeClickHandler = null;
    activeTargetEl = null;
  }

  // --- Step control ---
  function showStep(idx) {
    cleanupClickHandler();
    currentStep = idx;
    const step = STEPS[idx];
    if (!step) { endTour(); return; }

    elevateParent(step);
    if (step.onEnter) step.onEnter();

    if (step.waitFor && !step.waitFor()) {
      const check = setInterval(() => {
        if (step.waitFor()) {
          clearInterval(check);
          showStepUI(idx, step);
        }
      }, 200);
      return;
    }

    showStepUI(idx, step);
  }

  function showStepUI(idx, step) {
    const el = step.target ? step.target() : null;

    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });

    setTimeout(() => {
      const targetEl = step.target ? step.target() : null;
      positionSpotlight(targetEl);
      renderTooltip(step, idx);
      positionTooltip(step, targetEl);
      tooltip.classList.add('onb-visible');

      if (step.action === 'click-target' && targetEl) {
        targetEl.style.zIndex = '10002';
        targetEl.classList.add('onb-target-active');
        activeTargetEl = targetEl;

        activeClickHandler = () => {
          cleanupClickHandler();
          setTimeout(() => advanceStep(), 400);
        };
        targetEl.addEventListener('click', activeClickHandler);
      }
    }, 250);
  }

  function advanceStep() {
    cleanupClickHandler();
    restoreParent();
    tooltip.classList.remove('onb-visible');
    showStep(currentStep + 1);
  }

  function endTour() {
    const cb = tooltip && tooltip.querySelector('.onb-dont-show-cb');
    if (cb && cb.checked) localStorage.setItem(STORAGE_KEY, '1');
    cleanupClickHandler();
    restoreParent();
    window.removeEventListener('resize', onResizeOrScroll);
    window.removeEventListener('scroll', onResizeOrScroll, true);
    if (overlay) overlay.remove();
    if (tooltip) tooltip.remove();
    overlay = null;
    tooltip = null;
  }

  function startTour() {
    createOverlay();
    window.addEventListener('resize', onResizeOrScroll);
    window.addEventListener('scroll', onResizeOrScroll, true);
    showStep(0);
  }

  document.addEventListener('aidock-dashboard-ready', () => {
    if (localStorage.getItem(STORAGE_KEY)) return;
    const toolCount = document.querySelectorAll('.cards-grid .card').length;
    if (toolCount === 0) {
      setTimeout(startTour, 600);
    }
  });
})();
