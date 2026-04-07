// ═══════════════════════════════════════════════════════════════
// MOBILE — 抽屉切换 + 滑动手势
// ═══════════════════════════════════════════════════════════════

// ── 抽屉面板切换 ─────────────────────────────────────────────
function mobClose() {
  document.getElementById('map-panel').classList.remove('mob-open');
  document.getElementById('log-panel').classList.remove('mob-open');
  document.getElementById('mob-backdrop').classList.remove('mob-open');
  document.getElementById('mob-map-btn')?.classList.remove('active');
  document.getElementById('mob-log-btn')?.classList.remove('active');
}

function mobToggle(panel) {
  const mapPanel = document.getElementById('map-panel');
  const logPanel = document.getElementById('log-panel');
  const backdrop = document.getElementById('mob-backdrop');
  const mapBtn   = document.getElementById('mob-map-btn');
  const logBtn   = document.getElementById('mob-log-btn');

  const isMap    = panel === 'map';
  const target   = isMap ? mapPanel : logPanel;
  const btn      = isMap ? mapBtn  : logBtn;
  const other    = isMap ? logPanel : mapPanel;
  const otherBtn = isMap ? logBtn  : mapBtn;

  const opening = !target.classList.contains('mob-open');

  // 先关另一个
  other.classList.remove('mob-open');
  otherBtn?.classList.remove('active');

  if (opening) {
    target.classList.add('mob-open');
    backdrop.classList.add('mob-open');
    btn?.classList.add('active');
    // 打开日志时自动滚到顶（最新事件在顶部）
    if (!isMap) {
      const log = document.getElementById('event-log');
      if (log) log.scrollTop = 0;
    }
  } else {
    mobClose();
  }
}

// 点击遮罩关闭所有抽屉
document.getElementById('mob-backdrop')?.addEventListener('click', mobClose);


// ── 滑动手势（在走廊区滑动 → 触发对应方向按钮） ─────────────
(function initSwipe() {
  const el = document.getElementById('game-view');
  if (!el) return;

  let sx = 0, sy = 0, startTime = 0;
  const MIN_DIST = 40;   // px
  const MAX_TIME = 500;  // ms
  const MAX_RATIO = 2.5; // 主轴/副轴，防止斜滑误触

  el.addEventListener('touchstart', e => {
    if (e.touches.length !== 1) return;
    sx = e.touches[0].clientX;
    sy = e.touches[0].clientY;
    startTime = Date.now();
  }, { passive: true });

  el.addEventListener('touchend', e => {
    // 如果有 overlay 打开（minigame/event），忽略手势
    const mgActive = document.getElementById('minigame-overlay')?.classList.contains('active');
    const evActive = document.getElementById('event-overlay')?.classList.contains('active');
    if (mgActive || evActive) return;

    if (e.changedTouches.length !== 1) return;
    const dx = e.changedTouches[0].clientX - sx;
    const dy = e.changedTouches[0].clientY - sy;
    const dt = Date.now() - startTime;

    if (dt > MAX_TIME) return;

    const absDx = Math.abs(dx);
    const absDy = Math.abs(dy);
    if (Math.max(absDx, absDy) < MIN_DIST) return;

    let dir;
    if (absDx > absDy) {
      if (absDx / absDy < MAX_RATIO || absDy < 10) {
        dir = dx > 0 ? 'right' : 'left';
      }
    } else {
      if (absDy / absDx < MAX_RATIO || absDx < 10) {
        dir = dy > 0 ? 'down' : 'up';
      }
    }

    if (dir) triggerSwipeDir(dir);
  }, { passive: true });

  function triggerSwipeDir(swipeDir) {
    // 手势方向 → 游戏方向映射
    // 上滑 = 前进(up)，下滑 = 后退(down)，左滑 = 向左(left)，右滑 = 向右(right)
    const gameDir = { up: 'up', down: 'down', left: 'left', right: 'right' }[swipeDir];

    // 找到 choice-area 中对应方向的按钮并点击
    const btns = document.querySelectorAll('#choice-area .choice-btn');
    for (const btn of btns) {
      const d = btn.dataset.dir;
      if (d === gameDir && !btn.disabled) {
        // 触感反馈（如果支持）
        if (navigator.vibrate) navigator.vibrate(20);
        btn.click();
        return;
      }
    }
  }
})();


// ── 触摸友好：防止双击缩放 ───────────────────────────────────
document.addEventListener('touchend', e => {
  const t = e.target;
  if (t.classList.contains('choice-btn') || t.classList.contains('mob-btn')) {
    e.preventDefault();
  }
}, { passive: false });


// ── 竖屏/横屏切换提示（可选） ────────────────────────────────
// 仅在超窄横屏（高度<320px）时提示竖屏更好
function checkOrientation() {
  const warn = document.getElementById('orient-warn');
  if (!warn) return;
  warn.style.display = (window.innerHeight < 320 && window.innerWidth > window.innerHeight)
    ? 'flex' : 'none';
}
window.addEventListener('resize', checkOrientation);
window.addEventListener('orientationchange', checkOrientation);
checkOrientation();
