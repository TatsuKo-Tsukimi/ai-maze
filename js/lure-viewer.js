'use strict';

// ─── Lure Viewer: Fullscreen Overlay + Text Screenshot Renderer ──────────────
// Shows enhanced lure content after player "follows" a temptation:
//   1. Full-size image or text-as-screenshot
//   2. Agent narrative (typed out progressively)
//   3. Result reveal (clue or trap)

// ─── Path Display Sanitizer ────────────────────────────────────────────────
// Returns a display-safe version of a file path for use in UI headers.
// Never shows the full absolute path — shows at most "parent/filename".

function safeDisplayPath(fullPath, name) {
  if (name) return name;
  if (!fullPath || fullPath === 'unknown') return 'unknown';
  // Normalize separators, take last two segments (parent dir + filename)
  const parts = fullPath.replace(/\\/g, '/').split('/').filter(Boolean);
  if (parts.length === 0) return 'unknown';
  if (parts.length === 1) return parts[0];
  return parts.slice(-2).join('/');
}

// ─── Text File Viewer (VS Code dark theme style) ─────────────────────────────

function createTextViewer(filePath, content, maxLines = 30) {
  const viewer = document.createElement('div');
  viewer.className = 'text-file-viewer';

  // Header bar (macOS-style dots + filename)
  const header = document.createElement('div');
  header.className = 'file-viewer-header';
  header.innerHTML = `
    <span class="file-viewer-dot red"></span>
    <span class="file-viewer-dot yellow"></span>
    <span class="file-viewer-dot green"></span>
    <span class="file-viewer-title">${escapeHtml(filePath)}</span>
  `;
  viewer.appendChild(header);

  // Content area with line numbers
  const contentArea = document.createElement('div');
  contentArea.className = 'file-viewer-content';

  const lines = content.split('\n').slice(0, maxLines);
  const ext = filePath.split('.').pop().toLowerCase();

  lines.forEach((line, i) => {
    const lineEl = document.createElement('div');
    lineEl.className = 'file-line';
    lineEl.innerHTML = `
      <span class="line-no">${i + 1}</span>
      <span class="line-text">${highlightSyntax(escapeHtml(line), ext)}</span>
    `;
    contentArea.appendChild(lineEl);
  });

  if (content.split('\n').length > maxLines) {
    const more = document.createElement('div');
    more.className = 'file-line file-line-truncated';
    more.innerHTML = `<span class="line-no">…</span><span class="line-text dim">${t('lureViewer.moreLines', { n: content.split('\n').length - maxLines })}</span>`;
    contentArea.appendChild(more);
  }

  viewer.appendChild(contentArea);
  return viewer;
}

// ─── Syntax Highlighting (basic) ─────────────────────────────────────────────

function highlightSyntax(html, ext) {
  if (['md', 'txt'].includes(ext)) {
    // Markdown: headers, bold, links
    html = html.replace(/^(#{1,3}\s.*)/, '<span class="syn-heading">$1</span>');
    html = html.replace(/\*\*(.+?)\*\*/g, '<span class="syn-bold">**$1**</span>');
    html = html.replace(/`(.+?)`/g, '<span class="syn-code">`$1`</span>');
    return html;
  }
  if (['js', 'ts', 'py', 'sh'].includes(ext)) {
    // Code: comments, strings, keywords
    html = html.replace(/(\/\/.*)/, '<span class="syn-comment">$1</span>');
    html = html.replace(/(#.*)/, '<span class="syn-comment">$1</span>');
    html = html.replace(/(&quot;[^&]*&quot;|&#39;[^&]*&#39;)/g, '<span class="syn-string">$1</span>');
    html = html.replace(/\b(const|let|var|function|return|if|else|for|while|import|export|class|async|await|def|from)\b/g, '<span class="syn-keyword">$1</span>');
    return html;
  }
  if (['json', 'yaml', 'yml'].includes(ext)) {
    html = html.replace(/(&quot;[^&]*&quot;)\s*:/g, '<span class="syn-key">$1</span>:');
    html = html.replace(/:(\s*&quot;[^&]*&quot;)/g, ':<span class="syn-string">$1</span>');
    return html;
  }
  return html;
}

// ─── Fullscreen Lure Overlay ─────────────────────────────────────────────────

let _activeOverlay = null;

function isLureOverlayActive() {
  return !!_activeOverlay;
}

/**
 * Show the fullscreen lure overlay after player follows a temptation.
 *
 * @param {object} lureData - Enhanced lure item from server
 *   { type, path, description, tags, mood, lureHook, imagePath?, textPreview?, language? }
 * @param {object} options
 *   { onClose: fn, narrativeEndpoint: string }
 * @returns {HTMLElement} The overlay element
 */
function showLureOverlay(lureData, options = {}) {
  if (_activeOverlay) closeLureOverlay();

  const overlay = document.createElement('div');
  overlay.className = 'lure-fullscreen-overlay';
  overlay.id = 'lure-fullscreen-overlay';

  // ── Background noise texture ──
  const noise = document.createElement('div');
  noise.className = 'lure-overlay-noise';
  overlay.appendChild(noise);

  // ── Content container ──
  const container = document.createElement('div');
  container.className = 'lure-overlay-content';

  // ── Hook echo header (faded callback to the wall teaser that pulled the player in) ──
  if (lureData.lureHook || lureData.description) {
    const hookEcho = document.createElement('div');
    hookEcho.className = 'lure-hook-echo';
    // Use lureHook if available; fall back to first segment of description
    const echoText = lureData.lureHook
      || (lureData.description || '').split('，')[0].slice(0, 24);
    hookEcho.textContent = echoText;
    container.appendChild(hookEcho);
  }

  // ── Media: Image or Text viewer ──
  const mediaSection = document.createElement('div');
  mediaSection.className = 'lure-media-section';

  const resolvedImgPath = lureData.imagePath || (!lureData.isText ? lureData.path : null);
  if ((lureData.type === 'image' || resolvedImgPath) && !lureData.isText && resolvedImgPath) {
    const imgPath = String(resolvedImgPath || '').trim();
    if (imgPath) {
      const img = document.createElement('img');
      img.className = 'lure-fullscreen-image';
      img.src = `/api/lure/image?path=${encodeURIComponent(imgPath)}`;
      img.alt = lureData.description || '';
      // Show shimmer while loading, remove when done
      mediaSection.classList.add('loading');
      img.onload = () => {
        mediaSection.classList.remove('loading');
        img.classList.add('loaded');
      };
      img.onerror = () => mediaSection.classList.remove('loading');
      mediaSection.appendChild(img);
    }
  } else if (lureData.isText || lureData.textPreview || lureData.contentPreview) {
    const viewer = createTextViewer(
      safeDisplayPath(lureData.path, lureData.name),
      lureData.contentPreview || lureData.textPreview || '',
      30
    );
    mediaSection.appendChild(viewer);
  }

  container.appendChild(mediaSection);

  // ── Description badge (only for images — text files show content directly) ──
  if (lureData.description && !lureData.isText) {
    const desc = document.createElement('div');
    desc.className = 'lure-description';
    desc.textContent = lureData.description;
    container.appendChild(desc);
  }

  // ── Agent narrative area (filled async) ──
  const narrativeSection = document.createElement('div');
  narrativeSection.className = 'lure-narrative-section';
  narrativeSection.id = 'lure-narrative';

  const narrativeQuote = document.createElement('div');
  narrativeQuote.className = 'lure-narrative-text';
  const immediateSummary = (lureData.summary || lureData.description || lureData.lureHook || '').trim();
  const summaryEl = document.createElement('div');
  summaryEl.className = 'lure-narrative-summary';
  summaryEl.textContent = immediateSummary || '……';
  const commentaryEl = document.createElement('div');
  commentaryEl.className = 'lure-narrative-commentary hidden';
  narrativeQuote.appendChild(summaryEl);
  narrativeQuote.appendChild(commentaryEl);
  narrativeSection.appendChild(narrativeQuote);

  container.appendChild(narrativeSection);

  // ── Result reveal section (shown after narrative) ──
  const resultSection = document.createElement('div');
  resultSection.className = 'lure-result-section hidden';
  resultSection.id = 'lure-result';
  container.appendChild(resultSection);

  // ── Close / continue button (initially hidden, shown after result) ──
  const closeBtnRow = document.createElement('div');
  closeBtnRow.className = 'lure-close-row';
  const closeBtn = document.createElement('button');
  closeBtn.className = 'lure-overlay-close hidden';
  closeBtn.textContent = t('lureViewer.close');
  _lureOnClose = options.onClose || null;
  closeBtn.onclick = () => {
    closeLureOverlay();
  };
  const escHint = document.createElement('span');
  escHint.className = 'lure-esc-hint hidden';
  escHint.textContent = 'ESC';
  closeBtnRow.appendChild(closeBtn);
  closeBtnRow.appendChild(escHint);
  container.appendChild(closeBtnRow);

  overlay.appendChild(container);
  document.body.appendChild(overlay);
  _activeOverlay = overlay;

  // ── Backdrop click: close only after result has been revealed ──
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay && overlay.classList.contains('result-ready')) {
      closeLureOverlay();
    }
  });

  // Prevent body scroll while overlay is open (important on mobile)
  document.body.style.overflow = 'hidden';

  // Trigger entrance animation
  requestAnimationFrame(() => overlay.classList.add('visible'));

  // ── Reveal result independently; narrative is now best-effort async enrichment ──
  setTimeout(() => {
    revealResult(resultSection, options.result);
    setTimeout(() => {
      closeBtn.classList.remove('hidden');
      closeBtn.classList.add('visible');
      escHint.classList.remove('hidden');
      overlay.classList.add('result-ready');
      scrollToResult(container, resultSection);
    }, options.result ? 600 : 0);
  }, 400);

  // Use prefetched narrative if available, otherwise fetch async
  if (options.prefetchedNarrative) {
    Promise.resolve(options.prefetchedNarrative).then(narrative => {
      if (!narrative) return;
      if (immediateSummary && (narrative === immediateSummary || narrative.startsWith(immediateSummary))) {
        summaryEl.textContent = narrative;
        commentaryEl.textContent = '';
        commentaryEl.classList.add('hidden');
        return;
      }
      commentaryEl.textContent = narrative;
      commentaryEl.classList.remove('hidden');
    }).catch(() => {});
    console.log('[lure-viewer] using prefetched narrative');
  } else {
    fetchNarrative(lureData, immediateSummary, summaryEl, commentaryEl).catch(() => {});
  }

  return overlay;
}

/**
 * Fetch agent narrative from server and display with typewriter effect.
 * Returns a Promise that resolves when the narrative is fully displayed.
 */
async function fetchNarrative(lureData, baseSummary, summaryEl, commentaryEl) {
  try {
    const res = await fetch('/api/lure/narrative', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        gameId: lureData.gameId,
        summary: lureData.summary,
        description: lureData.description,
        tags: lureData.tags,
        mood: lureData.mood,
        path: lureData.path,
        name: lureData.name,
        type: lureData.type,
        isText: lureData.isText,
        lureHook: lureData.lureHook,
        textPreview: (lureData.contentPreview || lureData.textPreview || '').slice(0, 800),
        hp: lureData.hp,
        steps: lureData.steps,
      }),
    });
    const data = await res.json();
    const narrative = (data.narrative || '').trim();
    if (!narrative) return;
    if (baseSummary && (narrative === baseSummary || narrative.startsWith(baseSummary))) {
      summaryEl.textContent = narrative;
      commentaryEl.textContent = '';
      commentaryEl.classList.add('hidden');
      return;
    }
    commentaryEl.textContent = narrative;
    commentaryEl.classList.remove('hidden');
  } catch {
    // Keep immediate summary; no-op on async enrichment failure.
  }
}

// Varied trap texts for result reveal (to avoid repetition)
const TRAP_TEXTS = Array.from({ length: 12 }, (_, i) => t(`lureViewer.trap.${i + 1}`));
// Start at a random index so early games don't always see the same trap text
let _trapTextIdx = Math.floor(Math.random() * 3);
function nextTrapText(fallback) {
  if (fallback && fallback !== t('lureViewer.trapDefault')) return fallback;
  return TRAP_TEXTS[_trapTextIdx++ % TRAP_TEXTS.length];
}

// Varied clue texts for result reveal
// Templates with {dir} are filled with direction if available (e.g. 北方向)
const CLUE_TEXTS = Array.from({ length: 8 }, (_, i) => t(`lureViewer.clue.${i + 1}`));
// Clue templates that embed the direction naturally (used when direction is known)
const CLUE_DIR_TEXTS = Array.from({ length: 5 }, (_, i) => t(`lureViewer.clueDir.${i + 1}`));
let _clueTextIdx = 0;
let _clueDirIdx = 0;

// Context suffix lines for result reveal — rotated to avoid repetition
const CLUE_CTX_TEXTS = Array.from({ length: 6 }, (_, i) => t(`lureViewer.clueCtx.${i + 1}`));
const TRAP_CTX_TEXTS = Array.from({ length: 6 }, (_, i) => t(`lureViewer.trapCtx.${i + 1}`));
let _clueCtxIdx = 0;
let _trapCtxIdx = 0;
function nextClueCtx() {
  return CLUE_CTX_TEXTS[_clueCtxIdx++ % CLUE_CTX_TEXTS.length];
}
function nextTrapCtx() {
  return TRAP_CTX_TEXTS[_trapCtxIdx++ % TRAP_CTX_TEXTS.length];
}

function nextClueText(fallback) {
  // Keep original text if it's not the default placeholder
  const exitHintPrefix = t('lureViewer.exitHintDefault', { hint: '' }).split('{')[0];
  if (fallback && !fallback.startsWith(exitHintPrefix)) return fallback;
  // Extract direction if present (e.g. "出口似乎在北方向。" or "The exit seems to be to the north.")
  const dirMatch = fallback && (fallback.match(/在(.)方向/) || fallback.match(/to the (\w+)/i));
  if (dirMatch) {
    const dirName = dirMatch[1];
    const tmpl = CLUE_DIR_TEXTS[_clueDirIdx++ % CLUE_DIR_TEXTS.length];
    return tmpl.replace('{dir}', dirName);
  }
  return fallback || CLUE_TEXTS[_clueTextIdx++ % CLUE_TEXTS.length];
}

/**
 * Reveal the lure result (clue or trap) after narrative completes.
 * @param {HTMLElement} container - Result section element
 * @param {object|null} result - { type: 'clue'|'trap', text: string } or null
 */
function revealResult(container, result) {
  if (!result) {
    container.classList.add('hidden');
    return;
  }

  container.classList.remove('hidden');
  container.classList.add('visible');

  const isClue = result.type === 'clue';
  const icon = isClue ? '◈' : '✕';
  const label = isClue ? t('lureViewer.result.clue') : t('lureViewer.result.trap');
  // Use varied trap/clue text
  if (!isClue) {
    result = { ...result, text: nextTrapText(result.text) };
  } else {
    result = { ...result, text: nextClueText(result.text) };
  }
  // Brief flash on overlay background for dramatic reveal; mark clue result on overlay
  const overlayEl = document.getElementById('lure-fullscreen-overlay');
  if (overlayEl) {
    overlayEl.classList.add(isClue ? 'result-flash-clue' : 'result-flash-trap');
    setTimeout(() => overlayEl.classList.remove('result-flash-clue', 'result-flash-trap'), 600);
    if (isClue) overlayEl.classList.add('result-was-clue');
  }

  // Update close button text to reflect outcome
  const closeEl = overlayEl?.querySelector('.lure-overlay-close');
  if (closeEl) {
    const CLUE_CLOSE = Array.from({ length: 4 }, (_, i) => t(`lureViewer.closeClue.${i + 1}`));
    const TRAP_CLOSE = Array.from({ length: 4 }, (_, i) => t(`lureViewer.closeTrap.${i + 1}`));
    const pool = isClue ? CLUE_CLOSE : TRAP_CLOSE;
    closeEl.textContent = pool[Math.floor(Math.random() * pool.length)];
  }

  // Context line referencing the actual file so players know what they engaged with
  const fileCtx = result.fileName
    ? `<div class="lure-result-context">「${escapeHtml(result.fileName)}」${isClue ? nextClueCtx() : nextTrapCtx()}</div>`
    : '';

  container.innerHTML = `
    <div class="lure-result-badge ${isClue ? 'lure-result-clue' : 'lure-result-trap'}">
      <span class="lure-result-icon">${icon}</span>
      <span class="lure-result-label">${label}</span>
    </div>
    <div class="lure-result-text">${escapeHtml(result.text)}</div>
    ${fileCtx}
  `;
}

/**
 * Typewriter effect for agent narrative.
 */
function typewriterEffect(el, text, speed = 50) {
  return new Promise(resolve => {
    el.innerHTML = '';
    let i = 0;
    const cursor = document.createElement('span');
    cursor.className = 'narrative-cursor';
    cursor.textContent = '▎';

    function type() {
      if (i < text.length) {
        // Handle newlines
        if (text[i] === '\n') {
          el.appendChild(document.createElement('br'));
        } else {
          el.appendChild(document.createTextNode(text[i]));
        }
        i++;
        el.appendChild(cursor);
        setTimeout(type, speed + Math.random() * 30);
      } else {
        cursor.remove();
        resolve();
      }
    }
    type();
  });
}

/**
 * Smoothly scroll the container to show the result section.
 */
function scrollToResult(container, resultSection) {
  try {
    const offset = resultSection.offsetTop - container.offsetTop;
    container.scrollTo({ top: offset - 20, behavior: 'smooth' });
  } catch { /* non-critical */ }
}

/**
 * Close the fullscreen overlay.
 */
let _lureOnClose = null;

function closeLureOverlay() {
  if (!_activeOverlay) return;
  _activeOverlay.classList.remove('visible');
  _activeOverlay.classList.add('closing');
  // Restore body scroll
  document.body.style.overflow = '';
  const cb = _lureOnClose;
  _lureOnClose = null;
  setTimeout(() => {
    _activeOverlay?.remove();
    _activeOverlay = null;
    if (cb) cb();
  }, 500);
}

// ESC key to force-close lure overlay
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && _activeOverlay) {
    e.preventDefault();
    closeLureOverlay();
  }
});

// ─── Helpers ─────────────────────────────────────────────────────────────────

function escapeHtml(text) {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Export for use in mechanics.js
window.LureViewer = {
  show: showLureOverlay,
  close: closeLureOverlay,
  createTextViewer,
  isActive: isLureOverlayActive,
};
