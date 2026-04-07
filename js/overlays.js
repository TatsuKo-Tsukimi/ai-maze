// ═══════════════════════════════════════════════════════════════
// OVERLAY HELPERS — event overlay + screen overlay
// ═══════════════════════════════════════════════════════════════
function showEventOverlay(title, text, choices=[], imagePath=null, opts={}) {
  // Speculative prefetch: player will be reading overlay, prefetch next card
  if (typeof speculativePrefetch === 'function') speculativePrefetch(800);
  const overlay = DOM.id('event-overlay');
  overlay.classList.remove('event-temptation', 'tempt-beauty', 'tempt-breadcrumb', 'tempt-mirage', 'tempt-fakeexit');
  if (opts.temptation) overlay.classList.add('event-temptation');
  if (opts.temptTheme) overlay.classList.add(opts.temptTheme);
  const eventBox = DOM.id('event-box');
  if (eventBox) eventBox.dataset.overlayMode = opts.temptation ? 'temptation' : 'runtime';
  const shellKicker = eventBox?.querySelector('.shell-kicker');
  if (shellKicker) shellKicker.textContent = opts.temptation ? 'runtime / temptation intercept' : 'runtime / interrupt frame';
  UI.setText('event-title', title || (opts.temptation ? t('lure.overlay.fallback') : t('overlay.event.fallback')));
  // Use innerHTML if text contains HTML tags (e.g. glitch effects), otherwise textContent
  const textEl = DOM.id('event-text');
  if (/<[a-z][\s\S]*>/i.test(text)) {
    textEl.innerHTML = text;
  } else {
    textEl.textContent = text;
  }
  textEl.dataset.empty = textEl.textContent.trim() ? 'false' : 'true';
  // Image support: clear previous, add new if provided
  const oldImg = overlay.querySelector('.event-image');
  if (oldImg) oldImg.remove();
  if (imagePath) {
    const resolvedImagePath = String(imagePath || '').trim();
    if (resolvedImagePath) {
      const img = document.createElement('img');
      img.className = 'event-image';
      img.src = `/api/lure/image?path=${encodeURIComponent(resolvedImagePath)}`;
      img.alt = '';
      img.onerror = () => img.remove(); // graceful degradation
      // Insert before choices
      textEl.parentNode.insertBefore(img, textEl.nextSibling);
    }
  }
  const box = DOM.id('event-choices');
  box.innerHTML = '';
  choices.forEach((c, idx) => {
    const btn = document.createElement('button');
    btn.className = `event-btn ${c.alt ? 'alt' : ''}`.trim();
    btn.textContent = c.label;
    btn.dataset.actionIndex = String(idx + 1).padStart(2, '0');
    btn.dataset.promptRole = c.alt ? 'skip' : 'exec';
    btn.setAttribute('aria-label', `action ${idx + 1}: ${c.label}`);
    btn.onclick = () => { hideEventOverlay(); c.onClick?.(); };
    box.appendChild(btn);
  });
  box.dataset.empty = choices.length === 0 ? 'true' : 'false';
  overlay.classList.add('active');
}
function hideEventOverlay() {
  const overlay = DOM.id('event-overlay');
  if (overlay) {
    overlay.classList.add('closing');
    setTimeout(() => {
      overlay.classList.remove('active', 'closing');
    }, 300);
  }
  // Clean up any wall projections that were waiting for player choice
  document.querySelectorAll('[data-lure-projection]').forEach(el => {
    el.style.transition = 'opacity 1.2s ease-out, filter 1.2s ease-out';
    el.style.opacity = '0';
    el.style.filter = 'blur(8px)';
    setTimeout(() => el.remove(), 1300);
  });
}
function isEventOverlayActive() {
  return DOM.id('event-overlay').classList.contains('active');
}
function isMinigameActive() {
  return DOM.id('minigame-overlay').classList.contains('active');
}

// ── Screen overlay helpers ────────────────────────────────────
function showScreen(tpl, bgClass) {
  const ov = document.getElementById('screen-overlay');
  const ct = document.getElementById('screen-content');
  ov.className = '';
  void ov.offsetWidth;
  ct.innerHTML = tpl;
  ov.classList.add('active');
  if (bgClass) ov.classList.add(bgClass);
}
