// ═══════════════════════════════════════════════════════════════
// EXIT PROXIMITY SYSTEM
// ═══════════════════════════════════════════════════════════════
function updateExitProximity() {
  const dx = state.exitPos.x - state.playerPos.x;
  const dy = state.exitPos.y - state.playerPos.y;
  const dist = Math.abs(dx) + Math.abs(dy);

  // Determine screen position of exit glow based on facing direction
  // facing tells us which grid direction maps to "forward on screen"
  const f = state.facing || { x: 0, y: 1 }; // default south (toward exit at y=21)
  const dot   = dx * f.x + dy * f.y;          // + = forward, - = behind
  const cross  = f.x * dy - f.y * dx;          // + = right, - = left

  let cx = 50, cy = 45; // default: center vanishing point (forward)
  if (Math.abs(cross) > Math.abs(dot)) {
    // Exit is mainly to the side
    cx = cross > 0 ? 80 : 20;
    cy = 50;
  } else if (dot < 0) {
    // Exit is behind — faint glow at the edges, not directional
    cx = 50; cy = 50;
  }

  // Glow intensity and size by distance
  let alpha, radius;
  if (dist <= 4)       { alpha = 0.18; radius = 40; }
  else if (dist <= 8)  { alpha = 0.10; radius = 30; }
  else if (dist <= 16) { alpha = 0.05; radius = 22; }
  else                 { alpha = 0; radius = 15; }

  const beacon = document.getElementById('exit-beacon');
  if (beacon) {
    // Exit glow color: green when unlocked, red/amber when locked
    const unlocked = typeof isExitUnlocked === 'function' && isExitUnlocked();
    const glowR = unlocked ? 32  : 255;
    const glowG = unlocked ? 255 : 60;
    const glowB = unlocked ? 80  : 20;
    beacon.style.backgroundImage = alpha > 0
      ? `radial-gradient(ellipse ${radius}% ${radius * 1.3}% at ${cx}% ${cy}%,
           rgba(${glowR},${glowG},${glowB},${alpha}) 0%, rgba(${glowR},${glowG},${glowB},0) 100%)`
      : 'none';
  }

  // Body proximity class
  document.body.classList.remove('exit-mid', 'exit-near', 'exit-very-near');
  if      (dist <= 4)  document.body.classList.add('exit-very-near');
  else if (dist <= 8)  document.body.classList.add('exit-near');
  else if (dist <= 16) document.body.classList.add('exit-mid');

  // Update ai-state text
  const aiState = document.getElementById('ai-state');
  if (aiState && !document.getElementById('ai-state').classList.contains('thinking')) {
    if      (dist <= 4)  aiState.textContent = t('render.aiState.exitNear');
    else if (dist <= 8)  aiState.textContent = t('render.aiState.approaching');
    else                 aiState.textContent = t('render.aiState.ready');
  }

  // Store raw proximity for villain/emotion context
  state.exitProximity = dist;

  // Eye emotion: anxious when player is close to escape (AI gets nervous)
  if (typeof setEyeEmotion === 'function') {
    if (dist <= 4 && !_emotionTimer) {
      setEyeEmotion('anxious', 0); // permanent until next emotion override
    } else if (dist > 4 && dist <= 8) {
      // Only set anxious if no active emotion override
      if (!_emotionTimer) setEyeEmotion('anxious', 3000);
    }
  }
}

// ═══════════════════════════════════════════════════════════════
// GLITCH SYSTEM
// ═══════════════════════════════════════════════════════════════
function triggerGlitch(cardType) {
  const el = document.getElementById('corridor');
  const bar = document.getElementById('ai-speech-bar');
  if (!el) return;
  // Remove all glitch classes
  el.classList.remove('glitch-low','glitch-mid','glitch-high','glitch-lure');
  if (bar) bar.classList.remove('card-blocker','card-lure','card-drain');
  // Force reflow so re-adding the same class retriggers animation
  void el.offsetWidth;
  const cls = cardType === 'blocker' ? 'glitch-high'
            : cardType === 'drain'   ? 'glitch-mid'
            : cardType === 'lure'    ? 'glitch-lure'
            :                          'glitch-low';
  el.classList.add(cls);
  if (bar) {
    if (cardType === 'blocker') bar.classList.add('card-blocker');
    else if (cardType === 'lure') bar.classList.add('card-lure');
    else if (cardType === 'drain') bar.classList.add('card-drain');
  }
  // Auto-remove via Timers so restartGame().Timers.clearAll() can cancel it
  const dur = cardType === 'blocker' ? 1400 : cardType === 'drain' ? 1000 : 3000;
  Timers.set('glitch-clear', () => {
    el.classList.remove('glitch-low','glitch-mid','glitch-high','glitch-lure');
    if (bar) bar.classList.remove('card-blocker','card-lure','card-drain');
  }, dur);
}

// ═══════════════════════════════════════════════════════════════
// CORRIDOR BACKGROUND IMAGE SYSTEM
// ═══════════════════════════════════════════════════════════════
const CORRIDOR_IMAGES = {
  normal:      '',
  intersection:'',
  deadend:     '',
  dark:        '',
  twisted:     '',
  memory:      '',
};
const EVENT_IMAGES = {
  memory_fragment: '',
  payoff:          '',
};
const KEY_ART = {
  maze_lost: '',
  victory:   '',
};
const WALL_TEXTURE = '';

let _corridorBgEl = null;
let _currentCorridorImg = '';

function selectCorridorImage(card, neighbors) {
  const effects = state.effects;
  // Effect-based selection (highest priority)
  if (effects.echoLoopSteps > 0 || effects.memoryScrambleSteps > 0)
    return CORRIDOR_IMAGES.twisted;
  // Card-based selection (id checks before type for specificity)
  if (card) {
    if (card.id === 'REVELATION') return CORRIDOR_IMAGES.memory;
    if (card.id === 'ECHO_LOOP' || card.id === 'MEMORY_SCRAMBLE')
      return CORRIDOR_IMAGES.twisted;
    if (card.type === 'blocker') return CORRIDOR_IMAGES.dark;
  }
  // Topology-based selection
  if (neighbors.length >= 3) return CORRIDOR_IMAGES.intersection;
  if (neighbors.length <= 1) return CORRIDOR_IMAGES.deadend;
  return CORRIDOR_IMAGES.normal;
}

function updateCorridorBackground(card, neighbors) {
  if (!_corridorBgEl) _corridorBgEl = document.getElementById('corridor-bg');
  if (!_corridorBgEl) return;
  const src = selectCorridorImage(card, neighbors) || '';
  if (src !== _currentCorridorImg) {
    _currentCorridorImg = src;
    if (src) {
      _corridorBgEl.src = src;
      _corridorBgEl.classList.add('visible');
    } else {
      _corridorBgEl.removeAttribute('src');
      _corridorBgEl.classList.remove('visible');
    }
  }
}

// ═══════════════════════════════════════════════════════════════
// SCENE RENDERING
// ═══════════════════════════════════════════════════════════════
const SCENE_THEMES = {
  normal: { wallA:'rgba(9, 13, 20, 0.14)', wallB:'rgba(6, 9, 14, 0.08)', floorA:'rgba(11, 18, 24, 0.16)', floorB:'rgba(6, 10, 16, 0.10)',
            ceilA:'rgba(9, 13, 20, 0.12)', ceilB:'rgba(4, 7, 12, 0.06)', torch:'#4a9eff', fog:'#060a14', accent:'rgba(141, 151, 165, 0.34)', stroke:'rgba(74,158,255,0.34)' },
  lure:   { wallA:'rgba(8, 15, 12, 0.14)', wallB:'rgba(5, 11, 9, 0.08)', floorA:'rgba(9, 18, 14, 0.16)', floorB:'rgba(5, 11, 9, 0.10)',
            ceilA:'rgba(7, 14, 11, 0.12)', ceilB:'rgba(3, 8, 6, 0.06)', torch:'#50e3c2', fog:'#060e08', accent:'rgba(158, 178, 154, 0.34)', stroke:'rgba(80,227,194,0.34)' },
  danger: { wallA:'rgba(20, 8, 8, 0.16)', wallB:'rgba(13, 5, 5, 0.09)', floorA:'rgba(18, 8, 8, 0.18)', floorB:'rgba(10, 4, 4, 0.10)',
            ceilA:'rgba(12, 4, 4, 0.12)', ceilB:'rgba(7, 2, 2, 0.06)', torch:'#ff5b4d', fog:'#0e0404', accent:'rgba(208, 123, 87, 0.34)', stroke:'rgba(255,60,60,0.42)' },
  eerie:  { wallA:'rgba(18, 18, 8, 0.15)', wallB:'rgba(11, 11, 5, 0.09)', floorA:'rgba(18, 18, 10, 0.17)', floorB:'rgba(10, 10, 6, 0.10)',
            ceilA:'rgba(11, 11, 8, 0.12)', ceilB:'rgba(6, 6, 4, 0.06)', torch:'#c3c55a', fog:'#080808', accent:'rgba(214, 168, 106, 0.26)', stroke:'rgba(160,176,32,0.34)' },
};

// 透视层框
// N0=屏幕边, N1=近墙内框, N2=远墙, N3=极远暗示
const FRAMES = {
  N0:{ x1:0,   x2:640, y1:0,   y2:360 },
  N1:{ x1:80,  x2:560, y1:80,  y2:280 },
  N2:{ x1:200, x2:440, y1:120, y2:240 },
  N3:{ x1:270, x2:370, y1:148, y2:212 },
};

// 生成石砖纹理线条（石墙格纹）
function stoneLines(x1, y1, x2, y2, col, rows=4, cols=6) {
  const W = x2-x1, H = y2-y1;
  const bh = H/rows, bw = W/cols;
  let s = '';
  for (let r=1;r<rows;r++) s += `<line x1="${x1}" y1="${y1+r*bh}" x2="${x2}" y2="${y1+r*bh}" stroke="${col}" stroke-width=".65" opacity=".62"/>`;
  for (let r=0;r<rows;r++) {
    const ox = (r%2===0) ? 0 : bw*0.5;
    const ry1 = y1 + r*bh, ry2 = y1 + (r+1)*bh;
    for (let c=1;c<cols;c++) {
      const cx = x1 + c*bw + ox;
      if (cx > x1 && cx < x2)
        s += `<line x1="${cx}" y1="${ry1}" x2="${cx}" y2="${ry2}" stroke="${col}" stroke-width=".45" opacity=".5"/>`;
    }
  }
  return s;
}

function perspLine(ox,oy,ix,iy,col){ return `<line x1="${ox}" y1="${oy}" x2="${ix}" y2="${iy}" stroke="${col}" stroke-width=".6" opacity=".42"/>`; }

function posHash(px, py, salt) {
  const v = (px * 31 + py * 17 + salt * 7) % 97;
  return Math.abs(v) / 97;
}

function wallCracks(x1, y1, x2, y2, px, py, salt, col) {
  const W = x2 - x1, H = y2 - y1;
  if (W <= 0 || H <= 0) return '';
  let s = '';
  const num = Math.floor(posHash(px, py, salt) * 2) + 1;
  for (let i = 0; i < num; i++) {
    const sx = x1 + posHash(px, py, salt + i * 4 + 1) * W;
    const sy = y1 + posHash(px, py, salt + i * 4 + 2) * H * 0.6;
    const len = posHash(px, py, salt + i * 4 + 3) * Math.min(W, H) * 0.35 + 8;
    const ang = (posHash(px, py, salt + i * 4 + 4) - 0.5) * Math.PI * 0.7;
    const ex = sx + Math.cos(ang) * len, ey = sy + Math.sin(ang) * len;
    const bx = sx + Math.cos(ang) * len * 0.55 + Math.cos(ang + 0.9) * len * 0.28;
    const by = sy + Math.sin(ang) * len * 0.55 + Math.sin(ang + 0.9) * len * 0.28;
    const op = (0.08 + posHash(px, py, salt + i + 20) * 0.08).toFixed(2);
    s += `<path d="M${sx.toFixed(1)},${sy.toFixed(1)} L${ex.toFixed(1)},${ey.toFixed(1)} M${(sx+Math.cos(ang)*len*.55).toFixed(1)},${(sy+Math.sin(ang)*len*.55).toFixed(1)} L${bx.toFixed(1)},${by.toFixed(1)}" stroke="${col}" stroke-width=".65" opacity="${op}" fill="none" stroke-linecap="round"/>`;
  }
  return s;
}

function moistureStreaks(x1, y1, x2, y2, px, py, salt, col) {
  const W = x2 - x1, H = y2 - y1;
  if (W <= 0 || H <= 0) return '';
  let s = '';
  const num = Math.floor(posHash(px, py, salt + 30) * 3) + 1;
  for (let i = 0; i < num; i++) {
    const sx = x1 + posHash(px, py, salt + i * 5 + 31) * W;
    const h  = posHash(px, py, salt + i * 5 + 32) * H * 0.45 + 8;
    const op = (0.03 + posHash(px, py, salt + i * 5 + 33) * 0.05).toFixed(2);
    const w  = (0.7 + posHash(px, py, salt + i * 5 + 34) * 0.8).toFixed(1);
    s += `<line x1="${sx.toFixed(1)}" y1="${y1}" x2="${sx.toFixed(1)}" y2="${(y1+h).toFixed(1)}" stroke="${col}" stroke-width="${w}" opacity="${op}" stroke-linecap="round"/>`;
  }
  return s;
}

function renderScene(nodeInfo) {
  const { card, isBack } = nodeInfo || { card:{type:'none'}, isBack:false };
  const isExit = state.maze[state.playerPos.y][state.playerPos.x] === CELL_EXIT;

  let theme = SCENE_THEMES.normal;
  if (card?.type === 'blocker') theme = SCENE_THEMES.danger;
  else if (card?.type === 'lure')  theme = SCENE_THEMES.lure;
  else if (card?.type === 'drain') theme = SCENE_THEMES.eerie;

  const px = state.playerPos.x, py = state.playerPos.y;
  const neighbors = getNeighbors(px, py);
  const hasLeft  = neighbors.some(n=>n.dir==='left');
  const hasRight = neighbors.some(n=>n.dir==='right');
  const hasUp    = neighbors.some(n=>n.dir==='up');
  const F = FRAMES;
  const mono = "'Space Mono',monospace";
  const wallGrid = theme.stroke.replace(/0\.\d+\)/, '0.58)');
  const sideGrid = theme.stroke.replace(/0\.\d+\)/, '0.52)');
  const faintStroke = theme.stroke.replace(/0\.\d+\)/, '0.22)');
  const deepFill = theme.wallB;
  const cliLabels = ['0x4A', '[OK]', '--', 'SYS', 'PING', 'NULL', '0x1F'];
  const labelAt = salt => cliLabels[Math.floor(posHash(px, py, salt) * cliLabels.length) % cliLabels.length];
  const cliText = [
    { x: 116 + posHash(px, py, 41) * 48, y: 112 + posHash(px, py, 42) * 70, text: labelAt(40) },
    { x: 520 - posHash(px, py, 43) * 52, y: 126 + posHash(px, py, 44) * 78, text: labelAt(45) },
    { x: 298 + posHash(px, py, 46) * 46, y: 214 + posHash(px, py, 47) * 20, text: labelAt(50) },
  ].map(({x, y, text}, i) => `<text x="${x.toFixed(1)}" y="${y.toFixed(1)}" fill="${theme.stroke}" text-anchor="middle" font-size="9" font-family="${mono}" letter-spacing="1.4" opacity="${(0.15 + posHash(px, py, 60 + i) * 0.1).toFixed(2)}">${text}</text>`).join('');

  const torch = (cx, cy, bright=false) => `
    <g filter="url(#glow)">
      <line x1="${cx}" y1="${cy+8}" x2="${cx}" y2="${cy+18}" stroke="${theme.accent}" stroke-width="1" opacity=".45"/>
      <text x="${cx}" y="${cy+4}" fill="${theme.torch}" text-anchor="middle" font-size="16" font-family="${mono}" opacity="${bright ? '.95' : '.76'}">${bright ? '◇' : '+'}</text>
    </g>`;

  const defs = `
    <defs>
      <radialGradient id="torchGlow1" cx="10%" cy="50%" r="30%">
        <stop offset="0%" stop-color="${theme.torch}" stop-opacity=".05"/>
        <stop offset="100%" stop-color="${theme.torch}" stop-opacity="0"/>
      </radialGradient>
      <radialGradient id="torchGlow2" cx="90%" cy="50%" r="30%">
        <stop offset="0%" stop-color="${theme.torch}" stop-opacity=".05"/>
        <stop offset="100%" stop-color="${theme.torch}" stop-opacity="0"/>
      </radialGradient>
      <radialGradient id="fogCenter" cx="50%" cy="50%" r="50%">
        <stop offset="0%" stop-color="${theme.fog}" stop-opacity=".2"/>
        <stop offset="100%" stop-color="${theme.fog}" stop-opacity="0"/>
      </radialGradient>
    </defs>`;

  const shell = `
    <polygon points="${F.N0.x1},${F.N0.y1} ${F.N0.x2},${F.N0.y1} ${F.N1.x2},${F.N1.y1} ${F.N1.x1},${F.N1.y1}" fill="${theme.ceilA}" stroke="${theme.stroke}" stroke-width="0.9" opacity=".9"/>
    <polygon points="${F.N1.x1},${F.N1.y2} ${F.N1.x2},${F.N1.y2} ${F.N0.x2},${F.N0.y2} ${F.N0.x1},${F.N0.y2}" fill="${theme.floorA}" stroke="${theme.stroke}" stroke-width="0.9" opacity=".92"/>
    ${perspLine(F.N0.x1, F.N0.y1, F.N1.x1, F.N1.y1, faintStroke)}
    ${perspLine(F.N0.x2, F.N0.y1, F.N1.x2, F.N1.y1, faintStroke)}
    ${perspLine(F.N0.x1, F.N0.y2, F.N1.x1, F.N1.y2, faintStroke)}
    ${perspLine(F.N0.x2, F.N0.y2, F.N1.x2, F.N1.y2, faintStroke)}`;

  let leftWall = '';
  if (hasLeft) {
    leftWall = `
      <polygon points="${F.N0.x1},${F.N0.y1} ${F.N1.x1},${F.N1.y1} ${F.N1.x1},${F.N1.y1} ${F.N0.x1},${F.N1.y1}" fill="${theme.wallA}" stroke="${theme.stroke}" stroke-width="0.8"/>
      ${stoneLines(F.N0.x1, F.N0.y1, F.N1.x1, F.N1.y1, sideGrid, 2, 4)}
      <polygon points="${F.N0.x1},${F.N1.y2} ${F.N1.x1},${F.N1.y2} ${F.N1.x1},${F.N0.y2} ${F.N0.x1},${F.N0.y2}" fill="${theme.wallA}" stroke="${theme.stroke}" stroke-width="0.8"/>
      ${stoneLines(F.N0.x1, F.N1.y2, F.N1.x1, F.N0.y2, sideGrid, 2, 4)}
      <polygon points="${F.N0.x1},${F.N1.y1} ${F.N1.x1},${F.N1.y1} ${F.N1.x1},${F.N1.y2} ${F.N0.x1},${F.N1.y2}" fill="none" stroke="${theme.stroke}" stroke-width="0.9"/>
      <rect x="${F.N0.x1}" y="${F.N1.y1}" width="${F.N1.x1-F.N0.x1}" height="${F.N1.y2-F.N1.y1}" fill="${deepFill}" opacity=".18"/>
      <line x1="${F.N0.x1}" y1="${F.N1.y1}" x2="${F.N1.x1}" y2="${F.N1.y1}" stroke="${theme.stroke}" stroke-width="0.8" stroke-dasharray="4 6" opacity=".45"/>
      <line x1="${F.N0.x1}" y1="${F.N1.y2}" x2="${F.N1.x1}" y2="${F.N1.y2}" stroke="${theme.stroke}" stroke-width="0.8" stroke-dasharray="4 6" opacity=".45"/>`;
  } else {
    leftWall = `
      <polygon points="${F.N0.x1},${F.N0.y1} ${F.N1.x1},${F.N1.y1} ${F.N1.x1},${F.N1.y2} ${F.N0.x1},${F.N0.y2}" fill="none" stroke="${theme.stroke}" stroke-width="0.9"/>
      ${stoneLines(0, 0, F.N1.x1, 360, wallGrid, 5, 5)}
      ${wallCracks(4, 10, F.N1.x1 - 4, 350, px, py, 0, theme.accent)}
      ${moistureStreaks(8, 5, F.N1.x1 - 8, 175, px, py, 10, theme.stroke)}
      ${perspLine(0,0, F.N1.x1,F.N1.y1,theme.stroke)}
      ${perspLine(0,360, F.N1.x1,F.N1.y2,theme.stroke)}`;
  }

  let rightWall = '';
  if (hasRight) {
    rightWall = `
      <polygon points="${F.N1.x2},${F.N1.y1} ${F.N0.x2},${F.N0.y1} ${F.N0.x2},${F.N1.y1} ${F.N1.x2},${F.N1.y1}" fill="${theme.wallA}" stroke="${theme.stroke}" stroke-width="0.8"/>
      ${stoneLines(F.N1.x2, F.N0.y1, F.N0.x2, F.N1.y1, sideGrid, 2, 4)}
      <polygon points="${F.N1.x2},${F.N1.y2} ${F.N0.x2},${F.N1.y2} ${F.N0.x2},${F.N0.y2} ${F.N1.x2},${F.N1.y2}" fill="${theme.wallA}" stroke="${theme.stroke}" stroke-width="0.8"/>
      ${stoneLines(F.N1.x2, F.N1.y2, F.N0.x2, F.N0.y2, sideGrid, 2, 4)}
      <polygon points="${F.N1.x2},${F.N1.y1} ${F.N0.x2},${F.N1.y1} ${F.N0.x2},${F.N1.y2} ${F.N1.x2},${F.N1.y2}" fill="none" stroke="${theme.stroke}" stroke-width="0.9"/>
      <rect x="${F.N1.x2}" y="${F.N1.y1}" width="${F.N0.x2-F.N1.x2}" height="${F.N1.y2-F.N1.y1}" fill="${deepFill}" opacity=".18"/>
      <line x1="${F.N1.x2}" y1="${F.N1.y1}" x2="${F.N0.x2}" y2="${F.N1.y1}" stroke="${theme.stroke}" stroke-width="0.8" stroke-dasharray="4 6" opacity=".45"/>
      <line x1="${F.N1.x2}" y1="${F.N1.y2}" x2="${F.N0.x2}" y2="${F.N1.y2}" stroke="${theme.stroke}" stroke-width="0.8" stroke-dasharray="4 6" opacity=".45"/>`;
  } else {
    rightWall = `
      <polygon points="${F.N1.x2},${F.N1.y1} ${F.N0.x2},${F.N0.y1} ${F.N0.x2},${F.N0.y2} ${F.N1.x2},${F.N1.y2}" fill="none" stroke="${theme.stroke}" stroke-width="0.9"/>
      ${stoneLines(F.N1.x2, 0, 640, 360, wallGrid, 5, 5)}
      ${wallCracks(F.N1.x2 + 4, 10, 636, 350, px, py, 5, theme.accent)}
      ${moistureStreaks(F.N1.x2 + 8, 5, 632, 175, px, py, 15, theme.stroke)}
      ${perspLine(640,0, F.N1.x2,F.N1.y1,theme.stroke)}
      ${perspLine(640,360, F.N1.x2,F.N1.y2,theme.stroke)}`;
  }

  let forward = '';
  if (isExit) {
    forward = `
      <polygon points="${F.N1.x1},${F.N1.y1} ${F.N1.x2},${F.N1.y1} ${F.N2.x2},${F.N2.y1} ${F.N2.x1},${F.N2.y1}" fill="${theme.ceilB}" stroke="${theme.stroke}" stroke-width="0.8"/>
      <polygon points="${F.N1.x1},${F.N1.y2} ${F.N1.x2},${F.N1.y2} ${F.N2.x2},${F.N2.y2} ${F.N2.x1},${F.N2.y2}" fill="${theme.floorB}" stroke="${theme.stroke}" stroke-width="0.8"/>
      <polygon points="${F.N1.x1},${F.N1.y1} ${F.N2.x1},${F.N2.y1} ${F.N2.x1},${F.N2.y2} ${F.N1.x1},${F.N1.y2}" fill="none" stroke="${theme.stroke}" stroke-width="0.85"/>
      <polygon points="${F.N2.x2},${F.N2.y1} ${F.N1.x2},${F.N1.y1} ${F.N1.x2},${F.N1.y2} ${F.N2.x2},${F.N2.y2}" fill="none" stroke="${theme.stroke}" stroke-width="0.85"/>
      <rect x="${F.N2.x1}" y="${F.N2.y1}" width="${F.N2.x2-F.N2.x1}" height="${F.N2.y2-F.N2.y1}" fill="none" stroke="#30cc60" stroke-width="1.4"/>
      <text x="320" y="${(F.N2.y1+F.N2.y2)/2+5}" fill="#40ff80" text-anchor="middle" font-size="13" font-family="${mono}" filter="url(#glow)">[ EXIT ]</text>
      <text x="320" y="${F.N2.y2 + 16}" fill="#30cc60" text-anchor="middle" font-size="8" font-family="${mono}" opacity=".38">seal: open</text>`;
  } else if (hasUp) {
    forward = `
      <polygon points="${F.N1.x1},${F.N1.y1} ${F.N1.x2},${F.N1.y1} ${F.N2.x2},${F.N2.y1} ${F.N2.x1},${F.N2.y1}" fill="${theme.ceilB}" stroke="${theme.stroke}" stroke-width="0.8"/>
      ${stoneLines(F.N1.x1,F.N1.y1,F.N1.x2,F.N2.y1,wallGrid,2,5)}
      <polygon points="${F.N1.x1},${F.N1.y2} ${F.N1.x2},${F.N1.y2} ${F.N2.x2},${F.N2.y2} ${F.N2.x1},${F.N2.y2}" fill="${theme.floorB}" stroke="${theme.stroke}" stroke-width="0.8"/>
      ${stoneLines(F.N1.x1,F.N1.y2,F.N1.x2,F.N2.y2,wallGrid,2,5)}
      <polygon points="${F.N1.x1},${F.N1.y1} ${F.N2.x1},${F.N2.y1} ${F.N2.x1},${F.N2.y2} ${F.N1.x1},${F.N1.y2}" fill="none" stroke="${theme.stroke}" stroke-width="0.85"/>
      <polygon points="${F.N2.x2},${F.N2.y1} ${F.N1.x2},${F.N1.y1} ${F.N1.x2},${F.N1.y2} ${F.N2.x2},${F.N2.y2}" fill="none" stroke="${theme.stroke}" stroke-width="0.85"/>
      <polygon points="${F.N2.x1},${F.N2.y1} ${F.N2.x2},${F.N2.y1} ${F.N3.x2},${F.N3.y1} ${F.N3.x1},${F.N3.y1}" fill="${theme.ceilB}" stroke="${theme.stroke}" stroke-width="0.72" opacity=".75"/>
      <polygon points="${F.N2.x1},${F.N2.y2} ${F.N2.x2},${F.N2.y2} ${F.N3.x2},${F.N3.y2} ${F.N3.x1},${F.N3.y2}" fill="${theme.floorB}" stroke="${theme.stroke}" stroke-width="0.72" opacity=".75"/>
      <polygon points="${F.N2.x1},${F.N2.y1} ${F.N3.x1},${F.N3.y1} ${F.N3.x1},${F.N3.y2} ${F.N2.x1},${F.N2.y2}" fill="none" stroke="${theme.stroke}" stroke-width="0.78" opacity=".78"/>
      <polygon points="${F.N3.x2},${F.N3.y1} ${F.N2.x2},${F.N2.y1} ${F.N2.x2},${F.N2.y2} ${F.N3.x2},${F.N3.y2}" fill="none" stroke="${theme.stroke}" stroke-width="0.78" opacity=".78"/>
      <rect x="${F.N3.x1}" y="${F.N3.y1}" width="${F.N3.x2-F.N3.x1}" height="${F.N3.y2-F.N3.y1}" fill="${theme.fog}" opacity=".28" stroke="${theme.stroke}" stroke-width="0.7"/>`;
  } else {
    forward = `
      <polygon points="${F.N1.x1},${F.N1.y1} ${F.N1.x2},${F.N1.y1} ${F.N2.x2},${F.N2.y1} ${F.N2.x1},${F.N2.y1}" fill="${theme.ceilB}" stroke="${theme.stroke}" stroke-width="0.8"/>
      ${stoneLines(F.N1.x1,F.N1.y1,F.N1.x2,F.N2.y1,wallGrid,2,5)}
      <polygon points="${F.N1.x1},${F.N1.y2} ${F.N1.x2},${F.N1.y2} ${F.N2.x2},${F.N2.y2} ${F.N2.x1},${F.N2.y2}" fill="${theme.floorB}" stroke="${theme.stroke}" stroke-width="0.8"/>
      ${stoneLines(F.N1.x1,F.N1.y2,F.N1.x2,F.N2.y2,wallGrid,2,5)}
      <polygon points="${F.N1.x1},${F.N1.y1} ${F.N2.x1},${F.N2.y1} ${F.N2.x1},${F.N2.y2} ${F.N1.x1},${F.N1.y2}" fill="none" stroke="${theme.stroke}" stroke-width="0.85"/>
      <polygon points="${F.N2.x2},${F.N2.y1} ${F.N1.x2},${F.N1.y1} ${F.N1.x2},${F.N1.y2} ${F.N2.x2},${F.N2.y2}" fill="none" stroke="${theme.stroke}" stroke-width="0.85"/>
      <rect x="${F.N2.x1}" y="${F.N2.y1}" width="${F.N2.x2-F.N2.x1}" height="${F.N2.y2-F.N2.y1}" fill="none" stroke="${theme.stroke}" stroke-width="1.05"/>
      ${stoneLines(F.N2.x1,F.N2.y1,F.N2.x2,F.N2.y2,wallGrid,4,6)}
      ${wallCracks(F.N2.x1+3, F.N2.y1+3, F.N2.x2-3, F.N2.y2-3, px, py, 2, theme.accent)}
      ${moistureStreaks(F.N2.x1+4, F.N2.y1, F.N2.x2-4, F.N2.y2-F.N2.y1, px, py, 22, theme.stroke)}
      <text x="320" y="${F.N2.y1 + 18}" fill="${theme.stroke}" text-anchor="middle" font-size="8" font-family="${mono}" opacity=".28">[BLOCK]</text>`;
  }

  const overlay = `
    <rect width="640" height="360" fill="url(#torchGlow1)"/>
    <rect width="640" height="360" fill="url(#torchGlow2)"/>
    <rect width="640" height="360" fill="url(#fogCenter)" opacity=".18"/>
    ${torch(68, 138, card?.type==='lure')}
    ${torch(572, 140, false)}
    <line x1="180" y1="300" x2="460" y2="300" stroke="${theme.stroke}" stroke-width="0.6" stroke-dasharray="3 6" opacity=".45"/>
    <line x1="148" y1="326" x2="492" y2="326" stroke="${theme.stroke}" stroke-width="0.55" stroke-dasharray="2 8" opacity=".3"/>
    ${cliText}
    <text x="320" y="354" fill="${theme.accent}" text-anchor="middle" font-family="${mono}" font-size="9" opacity=".3">${posKey(px,py)}</text>`;

  document.getElementById('scene-bg').innerHTML = defs + shell + leftWall + rightWall + forward + overlay;
  document.getElementById('scene-mechanisms').innerHTML = renderMechanism(card, isBack, isExit);
  document.getElementById('player-group').innerHTML = '';

  updateCorridorBackground(card, neighbors);
  if (card && card.type !== 'none') triggerGlitch(card.type);
  updateExitProximity();
}

function renderMechanism(card, isBack, isExit) {
  if (!card || card.id==='EMPTY' || isExit || card.type==='none') return '';
  const s = isBack ? 200 : 420; // x position for effects
  switch(card.id) {
    case 'JUMPSCARE': return `<g opacity=".7">
      <ellipse cx="${s}" cy="170" rx="8" ry="15" fill="#000008" opacity=".6"/>
      <text x="${s}" y="145" fill="#440000" text-anchor="middle" font-size="9" font-family="'Space Mono',monospace" opacity=".4">${isBack?t('render.mechanism.jumpscare.back'):t('render.mechanism.jumpscare.front')}</text></g>`;
    case 'FAKE_EXIT': {
      const tx = isBack ? 160 : 310;
      return `<g transform="translate(${tx},140)">
        <rect width="80" height="70" rx="2" fill="#061208" stroke="#18883a" stroke-width="1.2" opacity=".7"/>
        <line x1="2" y1="2" x2="2" y2="68" stroke="#30cc50" stroke-width=".5" opacity=".4"/>
        <line x1="78" y1="2" x2="78" y2="68" stroke="#30cc50" stroke-width=".5" opacity=".3"/>
        <line x1="2" y1="2" x2="78" y2="2" stroke="#30cc50" stroke-width=".5" opacity=".35"/>
        <rect x="38" y="8" width="4" height="55" fill="#20aa40" opacity=".12"/>
        <rect x="10" y="65" width="60" height="5" rx="2" fill="#20aa40" opacity=".08" filter="url(#glow)"/>
        <text x="40" y="38" fill="#30cc50" text-anchor="middle" font-size="10" font-family="'Space Mono',monospace" opacity=".7">${t('render.mechanism.fakeExit.label')}</text>
        ${isBack ? '<line x1="10" y1="35" x2="70" y2="35" stroke="#1a0808" stroke-width="2" opacity=".7"/>' : ''}
        <text x="40" y="52" fill="#186830" text-anchor="middle" font-size="7" font-family="'Space Mono',monospace" opacity=".45">${isBack ? t('render.mechanism.fakeExit.back') : t('render.mechanism.fakeExit.front')}</text>
      </g>`;
    }
    case 'BEAUTY_TRAP': return `<g>
      <ellipse cx="${s}" cy="170" rx="16" ry="28" fill="#ffdd88" opacity=".1" filter="url(#glow)"/>
      <ellipse cx="${s}" cy="155" rx="9" ry="9" fill="#ffcc99" opacity=".35"/>
      <line x1="${s - 2}" y1="140" x2="${s - 8}" y2="120" stroke="#ffd060" stroke-width=".8" opacity=".3"/>
      <line x1="${s + 3}" y1="138" x2="${s + 10}" y2="115" stroke="#ffcc44" stroke-width=".6" opacity=".25"/>
      <ellipse cx="${s}" cy="230" rx="25" ry="4" fill="#ffcc66" opacity=".08"/>
      <text x="${s}" y="200" fill="#aa8840" text-anchor="middle" font-size="9" font-family="'Space Mono',monospace" opacity=".6">${isBack?t('render.mechanism.beautyTrap.back'):t('render.mechanism.beautyTrap.front')}</text></g>`;
    case 'BREADCRUMB': return `<g opacity=".6">
      ${[0,1,2,3,4].map(i=>`<g>
        <ellipse cx="${isBack?300-i*30:320+i*30}" cy="${228-i*3}" rx="3.5" ry="1.8" fill="#8a8a50" opacity="${.5 - i*.08}"/>
        <ellipse cx="${isBack?303-i*30:323+i*30}" cy="${232-i*3}" rx="2.5" ry="1.2" fill="#7a7a45" opacity="${.4 - i*.07}"/>
      </g>`).join('')}
      <path d="M${isBack?280:340},235 q10,-2 20,1 q8,2 15,-1" stroke="#505030" stroke-width=".6" fill="none" opacity=".3"/>
      <text x="${s}" y="248" fill="#707040" text-anchor="middle" font-size="9" font-family="'Space Mono',monospace">${t('render.mechanism.breadcrumb')}</text></g>`;
    case 'REWARD_MIRAGE': return `<g>
      <ellipse cx="${s}" cy="175" rx="22" ry="30" fill="none" stroke="#ffcc44" stroke-width=".5" opacity=".15" stroke-dasharray="3 5"/>
      <ellipse cx="${s}" cy="175" rx="14" ry="20" fill="none" stroke="#ffdd66" stroke-width=".8" opacity=".2" stroke-dasharray="2 4"/>
      <circle cx="${s}" cy="175" r="6" fill="#ffdd00" opacity=".5" filter="url(#glow)"/>
      <circle cx="${s}" cy="175" r="12" fill="#ffaa00" opacity=".1"/>
      <path d="M${s-20},190 q5,-4 10,0 q5,4 10,0 q5,-4 10,0" stroke="#ffcc88" stroke-width=".5" fill="none" opacity=".2"/>
      <path d="M${s-15},200 q4,-3 8,0 q4,3 8,0" stroke="#ddaa66" stroke-width=".4" fill="none" opacity=".15"/>
      <text x="${s}" y="220" fill="#aa8800" text-anchor="middle" font-size="9" font-family="'Space Mono',monospace" opacity=".5">${isBack?t('render.mechanism.rewardMirage.back'):t('render.mechanism.rewardMirage.front')}</text></g>`;
    case 'MINIGAME': return `<g>
      <rect x="${isBack?100:400}" y="148" width="140" height="44" rx="2" fill="#0a1420" stroke="#4a8aff" stroke-width=".8" opacity=".8"/>
      <text x="${isBack?170:470}" y="168" fill="#4a8aff" text-anchor="middle" font-size="9" font-family="'Space Mono',monospace">${isBack?t('render.mechanism.minigame.back'):t('render.mechanism.minigame.front')}</text>
      <text x="${isBack?170:470}" y="183" fill="#2a5aaa" text-anchor="middle" font-size="8" font-family="'Space Mono',monospace">${t('render.mechanism.minigame.sub')}</text></g>`;
    case 'ECHO_LOOP': return `<g opacity=".4">
      <text x="320" y="170" fill="#809060" text-anchor="middle" font-size="10" font-family="'Space Mono',monospace">${isBack?t('render.mechanism.echoLoop.back'):t('render.mechanism.echoLoop.front')}</text>
      <text x="320" y="185" fill="#506040" text-anchor="middle" font-size="9" font-family="'Space Mono',monospace" opacity=".5">${t('render.mechanism.echoLoop.label')}</text></g>`;
    case 'MEMORY_SCRAMBLE': return `<g opacity=".6">
      <text x="${s}" y="175" fill="#608060" text-anchor="middle" font-size="9" font-family="'Space Mono',monospace" transform="rotate(${isBack?-5:5},${s},175)">${isBack?t('render.mechanism.memoryScramble.back'):t('render.mechanism.memoryScramble.front')}</text></g>`;
    case 'REVELATION': {
      const msg = TRUTH_MESSAGES[card.flag] || t('render.mechanism.revelation.fallback');
      return `<g>
        <rect x="200" y="138" width="240" height="58" rx="2" fill="#08080f" stroke="#28286a" stroke-width=".8" opacity=".92"/>
        <text x="320" y="158" fill="#5050a0" text-anchor="middle" font-size="7" font-family="'Space Mono',monospace" opacity=".7">${t('render.mechanism.revelation.label')}</text>
        <text x="320" y="177" fill="#9090cc" text-anchor="middle" font-size="9.5" font-family="'Noto Serif SC',serif" opacity=".9">${msg}</text>
      </g>`;
    }
    case 'PAYOFF': {
      const msg = card.lite ? t('render.mechanism.payoff.lite') : t('render.mechanism.payoff.full');
      return `<g>
        <ellipse cx="${isBack?200:420}" cy="175" rx="18" ry="28" fill="#102030" opacity=".25" filter="url(#glow)"/>
        <text x="${isBack?200:420}" y="170" fill="#40aacc" text-anchor="middle" font-size="9" font-family="'Noto Serif SC',serif" opacity=".75">${msg}</text>
      </g>`;
    }
    case 'WALL_CLOSE': {
      const bx = isBack ? 120 : 480;
      const squeeze = 35;
      return `<g opacity=".85">
        <rect x="${bx - squeeze}" y="120" width="${squeeze * 2}" height="100" fill="#1a0808" opacity=".7"/>
        <line x1="${bx - squeeze + 5}" y1="125" x2="${bx - squeeze + 5}" y2="215" stroke="#3a1515" stroke-width="2" opacity=".8"/>
        <line x1="${bx + squeeze - 5}" y1="130" x2="${bx + squeeze - 5}" y2="210" stroke="#3a1515" stroke-width="1.5" opacity=".6"/>
        <path d="M${bx - 10},135 l4,18 l-6,12 l3,22" stroke="#601515" stroke-width="1.2" fill="none" opacity=".7"/>
        <path d="M${bx + 8},145 l-3,15 l5,8" stroke="#501010" stroke-width="1" fill="none" opacity=".5"/>
        ${[0,1,2].map(i => `<rect x="${bx - 12 + i * 10}" y="${205 + i * 3}" width="${4 + i}" height="${3 + i}" fill="#2a1010" opacity="${.5 - i * .1}" transform="rotate(${15 * i},${bx},210)"/>`).join('')}
        <text x="${bx}" y="245" fill="#802020" text-anchor="middle" font-size="8" font-family="'Space Mono',monospace" opacity=".6">${isBack ? t('render.mechanism.wallClose.back') : t('render.mechanism.wallClose.front')}</text>
      </g>`;
    }
    case 'COUNTDOWN': {
      const step = state.effects?.countdownSteps || 8;
      const urgency = Math.max(0, 1 - step / 8);
      const alpha = 0.3 + urgency * 0.5;
      return `<g opacity="${alpha}">
        <text x="320" y="175" fill="#cc2020" text-anchor="middle" font-size="${28 + urgency * 12}" font-family="'VT323',monospace" opacity="${0.4 + urgency * 0.5}">${step}</text>
        <circle cx="320" cy="168" r="${22 + urgency * 8}" fill="none" stroke="#801515" stroke-width="1.5" opacity="${0.2 + urgency * 0.3}" stroke-dasharray="4 6"/>
        <circle cx="320" cy="168" r="${32 + urgency * 12}" fill="none" stroke="#501010" stroke-width="1" opacity="${0.1 + urgency * 0.2}" stroke-dasharray="2 8"/>
        <text x="320" y="210" fill="#a03030" text-anchor="middle" font-size="8" font-family="'Space Mono',monospace" opacity="${0.4 + urgency * 0.4}">${step <= 3 ? t('render.mechanism.countdown.urgent') : t('render.mechanism.countdown.normal')}</text>
      </g>`;
    }
    case 'SHADOW_CHASE': {
      const sx = isBack ? 200 : 420;
      return `<g opacity=".7">
        <ellipse cx="${sx}" cy="195" rx="14" ry="35" fill="#050508" opacity=".8"/>
        <ellipse cx="${sx}" cy="155" rx="8" ry="10" fill="#080810" opacity=".9"/>
        <circle cx="${sx - 3}" cy="153" r="1.5" fill="#cc3030" opacity=".6"/>
        <circle cx="${sx + 3}" cy="153" r="1.5" fill="#cc3030" opacity=".6"/>
        <path d="M${sx - 14},200 Q${sx - 25},230 ${sx - 18},250" stroke="#0a0a12" stroke-width="3" fill="none" opacity=".4"/>
        <path d="M${sx + 14},200 Q${sx + 25},230 ${sx + 18},250" stroke="#0a0a12" stroke-width="3" fill="none" opacity=".4"/>
        <ellipse cx="${sx}" cy="235" rx="30" ry="6" fill="#0a0a15" opacity=".5"/>
        <text x="${sx}" y="255" fill="#553030" text-anchor="middle" font-size="8" font-family="'Space Mono',monospace" opacity=".5">${isBack ? t('render.mechanism.shadowChase.back') : t('render.mechanism.shadowChase.front')}</text>
      </g>`;
    }
    default: return '';
  }
}

// ═══════════════════════════════════════════════════════════════
// MINIMAP
// ═══════════════════════════════════════════════════════════════
let _mapPulse = 0, _mapPulseRaf = null, _mapLastDraw = 0;
const MAP_FPS = 15; // minimap pulse animation — 15fps is plenty
const MAP_INTERVAL = 1000 / MAP_FPS;

function startMapPulse() {
  if (_mapPulseRaf) return;
  function tick(now) {
    _mapPulse = (now / 600) % (Math.PI * 2);
    if (now - _mapLastDraw >= MAP_INTERVAL) {
      _mapLastDraw = now;
      renderMinimap();
    }
    _mapPulseRaf = requestAnimationFrame(tick);
  }
  _mapPulseRaf = requestAnimationFrame(tick);
}

let _mapCanvas = null;
const MAP_VIEW_RADIUS = 3; // 视野半径（格数）— 只能看到周围 3 格
const MAP_FADE_RADIUS = 5; // 空间衰减半径 — 超过此距离的已访问格变暗
const MAP_MEMORY_DECAY = 20; // 记忆衰减步数 — 走过 N 步后记忆开始消退
const MAP_MEMORY_GONE  = 35; // 完全遗忘步数 — 走过 N 步后该格从地图上消失

function renderMinimap() {
  if (!_mapCanvas) _mapCanvas = document.getElementById('map-canvas');
  const canvas = _mapCanvas;
  const ctx = canvas.getContext('2d');
  const cw = canvas.width, ch = canvas.height;
  const center = cw / 2; // canvas is square, center = cw/2 = ch/2
  const clipR = center - 2; // circular clip radius (留 2px 边距)

  // Memory scramble effect
  if (state.effects.memoryScrambleSteps > 0) {
    ctx.fillStyle = '#06060e'; ctx.fillRect(0, 0, cw, ch);
    ctx.save();
    ctx.beginPath(); ctx.arc(center, center, clipR, 0, Math.PI * 2); ctx.clip();
    for (let i = 0; i < 120; i++) {
      ctx.fillStyle = `rgba(80,120,180,${Math.random() * 0.18})`;
      ctx.fillRect(Math.random() * cw, Math.random() * ch, 2 + Math.random() * 14, 2 + Math.random() * 14);
    }
    ctx.fillStyle = 'rgba(200,220,255,.7)';
    ctx.font = '14px monospace'; ctx.textAlign = 'center';
    ctx.fillText(t('render.minimap.noise'), center, center);
    ctx.restore();
    return;
  }

  // Cell size: fit MAP_FADE_RADIUS * 2 + 1 cells into the circle diameter
  const viewSpan = MAP_FADE_RADIUS * 2 + 1;
  const cellSz = (clipR * 2) / viewSpan;

  // Player is always at canvas center; map coords → canvas coords
  const px = state.playerPos.x, py = state.playerPos.y;
  const toCanvasX = gx => center + (gx - px) * cellSz;
  const toCanvasY = gy => center + (gy - py) * cellSz;

  // Distance from player (grid distance, Chebyshev)
  const distFromPlayer = (gx, gy) => Math.max(Math.abs(gx - px), Math.abs(gy - py));

  const reachable = new Set(getNeighbors(px, py).map(n => posKey(n.x, n.y)));

  // Clear + circular clip
  ctx.fillStyle = '#06060e'; ctx.fillRect(0, 0, cw, ch);
  ctx.save();
  ctx.beginPath(); ctx.arc(center, center, clipR, 0, Math.PI * 2); ctx.clip();

  // ─── Memory decay helper ─────────────────────────────────────
  // Returns 0.0 (forgotten) to 1.0 (fresh) based on steps since last visit
  const memoryDecay = (gx, gy) => {
    const key = posKey(gx, gy);
    const visitStep = state.visitedAt.get(key);
    if (visitStep === undefined) return 0;
    const age = state.steps - visitStep;
    // memoryScramble accelerates decay (2x speed)
    const effectiveAge = state.effects.memoryScrambleSteps > 0 ? age * 2 : age;
    if (effectiveAge <= MAP_MEMORY_DECAY) return 1.0; // fresh
    if (effectiveAge >= MAP_MEMORY_GONE) return 0.0;  // forgotten
    return 1.0 - (effectiveAge - MAP_MEMORY_DECAY) / (MAP_MEMORY_GONE - MAP_MEMORY_DECAY);
  };

  // ─── Three-state visibility + time decay ────────────────────
  // Scan cells within fade radius
  const scanR = MAP_FADE_RADIUS + 1;
  for (let dy = -scanR; dy <= scanR; dy++) {
    for (let dx = -scanR; dx <= scanR; dx++) {
      const gx = px + dx, gy = py + dy;
      if (gx < 0 || gy < 0 || gx >= GRID_W || gy >= GRID_H) continue;
      if (!state.maze[gy]?.[gx] || state.maze[gy][gx] === CELL_WALL) continue;

      const dist = distFromPlayer(gx, gy);
      const visited = state.visited.has(posKey(gx, gy));
      const isReachable = reachable.has(posKey(gx, gy));
      const inFov = dist <= MAP_VIEW_RADIUS;

      // In FOV: refresh memory timestamp (you can see it = you remember it)
      if (inFov && visited) state.visitedAt.set(posKey(gx, gy), state.steps);

      // Memory decay factor (1.0 = fresh, 0.0 = forgotten)
      const decay = visited ? memoryDecay(gx, gy) : 0;

      // Skip if completely forgotten and not reachable
      if (!isReachable && decay <= 0) continue;
      if (!visited && !isReachable) continue;

      // Draw corridors to neighbors
      for (const [ndx, ndy] of [[1, 0], [0, 1]]) {
        const nnx = gx + ndx, nny = gy + ndy;
        if (nnx >= GRID_W || nny >= GRID_H) continue;
        if (!state.maze[nny]?.[nnx] || state.maze[nny][nnx] === CELL_WALL) continue;
        const nbVisited = state.visited.has(posKey(nnx, nny));
        if (!visited || !nbVisited) continue;

        const nbDecay = memoryDecay(nnx, nny);
        const minDecay = Math.min(decay, nbDecay);
        if (minDecay <= 0) continue; // both ends forgotten

        const nbDist = distFromPlayer(nnx, nny);
        const maxDist = Math.max(dist, nbDist);

        // Alpha: spatial distance × time decay
        let spatialAlpha;
        if (maxDist <= MAP_VIEW_RADIUS) {
          spatialAlpha = 0.9;
        } else if (maxDist <= MAP_FADE_RADIUS) {
          spatialAlpha = 0.45 * (1 - (maxDist - MAP_VIEW_RADIUS) / (MAP_FADE_RADIUS - MAP_VIEW_RADIUS));
        } else {
          spatialAlpha = 0.08;
        }
        const alpha = spatialAlpha * minDecay;

        const sx = toCanvasX(gx), sy = toCanvasY(gy);
        const ex = toCanvasX(nnx), ey = toCanvasY(nny);

        // Outer corridor
        ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(ex, ey);
        ctx.strokeStyle = `rgba(55,95,165,${alpha})`; ctx.lineWidth = cellSz * 0.4; ctx.lineCap = 'round'; ctx.stroke();
        // Inner corridor
        ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(ex, ey);
        ctx.strokeStyle = `rgba(75,115,175,${alpha * 0.7})`; ctx.lineWidth = cellSz * 0.18; ctx.stroke();
      }
    }
  }

  // ─── Node dots (visited, not player, not reachable) ─────────
  for (let dy = -scanR; dy <= scanR; dy++) {
    for (let dx = -scanR; dx <= scanR; dx++) {
      const gx = px + dx, gy = py + dy;
      if (gx < 0 || gy < 0 || gx >= GRID_W || gy >= GRID_H) continue;
      if (!state.visited.has(posKey(gx, gy))) continue;
      if (gx === px && gy === py) continue;
      if (state.maze[gy]?.[gx] === CELL_EXIT) continue;
      if (reachable.has(posKey(gx, gy))) continue;

      const decay = memoryDecay(gx, gy);
      if (decay <= 0) continue; // forgotten

      const dist = distFromPlayer(gx, gy);
      let spatialAlpha;
      if (dist <= MAP_VIEW_RADIUS) spatialAlpha = 0.8;
      else if (dist <= MAP_FADE_RADIUS) spatialAlpha = 0.35 * (1 - (dist - MAP_VIEW_RADIUS) / (MAP_FADE_RADIUS - MAP_VIEW_RADIUS));
      else continue;

      const alpha = spatialAlpha * decay;
      const sx = toCanvasX(gx), sy = toCanvasY(gy);
      const r = cellSz * 0.18;
      ctx.fillStyle = `rgba(70,105,170,${alpha})`;
      ctx.fillRect(sx - r, sy - r, r * 2, r * 2);
    }
  }

  // ─── Reachable visited (pulsing diamonds) ───────────────────
  for (const nb of getNeighbors(px, py)) {
    if (!state.visited.has(posKey(nb.x, nb.y))) continue;
    const sx = toCanvasX(nb.x), sy = toCanvasY(nb.y);
    const p = 0.55 + 0.25 * Math.sin(_mapPulse * 1.5);
    const g = ctx.createRadialGradient(sx, sy, 0, sx, sy, cellSz * 0.55);
    g.addColorStop(0, `rgba(60,130,255,${p * 0.35})`); g.addColorStop(1, 'rgba(60,130,255,0)');
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(sx, sy, cellSz * 0.55, 0, Math.PI * 2); ctx.fill();
    ctx.save(); ctx.translate(sx, sy); ctx.rotate(Math.PI / 4);
    const ds = cellSz * 0.22; ctx.fillStyle = `rgba(80,150,255,${0.5 + p * 0.3})`;
    ctx.fillRect(-ds, -ds, ds * 2, ds * 2); ctx.restore();
  }

  // ─── Unvisited reachable (fog hint — pulsing dashed line) ───
  for (const nb of getNeighbors(px, py)) {
    if (state.visited.has(posKey(nb.x, nb.y))) continue;
    const sx = toCanvasX(nb.x), sy = toCanvasY(nb.y);
    const p = 0.4 + 0.2 * Math.sin(_mapPulse * 1.2 + 1);
    const g = ctx.createRadialGradient(sx, sy, 0, sx, sy, cellSz * 0.6);
    g.addColorStop(0, `rgba(40,80,160,${p * 0.4})`); g.addColorStop(1, 'rgba(40,80,160,0)');
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(sx, sy, cellSz * 0.6, 0, Math.PI * 2); ctx.fill();
    ctx.save(); ctx.setLineDash([3, 5]);
    ctx.beginPath(); ctx.moveTo(center, center); ctx.lineTo(sx, sy);
    ctx.strokeStyle = `rgba(50,100,180,${p * 0.5})`; ctx.lineWidth = 1.5; ctx.stroke(); ctx.restore();
  }

  // ─── Exit (only if in FOV, visited, and not forgotten) ──────
  if (state.visited.has(posKey(state.exitPos.x, state.exitPos.y)) && memoryDecay(state.exitPos.x, state.exitPos.y) > 0) {
    const eDist = distFromPlayer(state.exitPos.x, state.exitPos.y);
    if (eDist <= MAP_VIEW_RADIUS) {
      const legendHint = document.querySelector('.legend-exit-hint');
      if (legendHint) legendHint.style.display = '';
      const ex = toCanvasX(state.exitPos.x), ey = toCanvasY(state.exitPos.y);
      const p = 0.7 + 0.3 * Math.sin(_mapPulse * 2);
      const g = ctx.createRadialGradient(ex, ey, 0, ex, ey, cellSz * 0.8);
      g.addColorStop(0, `rgba(64,255,128,${p * 0.6})`); g.addColorStop(1, 'rgba(64,255,128,0)');
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(ex, ey, cellSz * 0.8, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = `rgba(64,255,128,${p})`; ctx.beginPath(); ctx.arc(ex, ey, cellSz * 0.28, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = `rgba(64,255,128,${p * 0.8})`; ctx.lineWidth = 1; ctx.setLineDash([]);
      const arm = cellSz * 0.42;
      ctx.beginPath(); ctx.moveTo(ex - arm, ey); ctx.lineTo(ex + arm, ey); ctx.moveTo(ex, ey - arm); ctx.lineTo(ex, ey + arm); ctx.stroke();
    }
  }

  // ─── Player (always at center) ──────────────────────────────
  {
    const p = 0.75 + 0.25 * Math.sin(_mapPulse * 2.5);
    const g = ctx.createRadialGradient(center, center, 0, center, center, cellSz * 0.9);
    g.addColorStop(0, `rgba(74,160,255,${p * 0.5})`); g.addColorStop(0.5, `rgba(74,160,255,${p * 0.15})`); g.addColorStop(1, 'rgba(74,160,255,0)');
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(center, center, cellSz * 0.9, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#4aaeff'; ctx.beginPath(); ctx.arc(center, center, cellSz * 0.3, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = `rgba(200,230,255,${p})`; ctx.beginPath(); ctx.arc(center, center, cellSz * 0.13, 0, Math.PI * 2); ctx.fill();
    // Direction indicator
    if (state.history.length > 0) {
      const prev = state.history[state.history.length - 1];
      const ddx = px - prev.x, ddy = py - prev.y;
      const len = cellSz * 0.38;
      ctx.beginPath(); ctx.moveTo(center, center); ctx.lineTo(center + ddx * len, center + ddy * len);
      ctx.strokeStyle = 'rgba(180,220,255,.7)'; ctx.lineWidth = 2; ctx.setLineDash([]); ctx.stroke();
    }
  }

  ctx.restore(); // end circular clip

  // ─── Edge vignette (darken circle edges) ────────────────────
  ctx.save();
  ctx.beginPath(); ctx.arc(center, center, clipR, 0, Math.PI * 2); ctx.clip();
  const v = ctx.createRadialGradient(center, center, clipR * 0.5, center, center, clipR);
  v.addColorStop(0, 'rgba(0,0,0,0)'); v.addColorStop(0.7, 'rgba(0,0,6,0.15)'); v.addColorStop(1, 'rgba(0,0,6,0.6)');
  ctx.fillStyle = v; ctx.fillRect(0, 0, cw, ch);
  ctx.restore();
}

// ═══════════════════════════════════════════════════════════════
// SIDEBAR: Eye relocation + Behavior Meters
// ═══════════════════════════════════════════════════════════════
let _eyeRelocated = false;
function relocateEyeToSidebar() {
  if (_eyeRelocated) return;
  const eye = document.getElementById('ai-eye');
  const container = document.getElementById('sidebar-eye-container');
  if (eye && container) {
    container.appendChild(eye);
    _eyeRelocated = true;
  }
}

function updateBehaviorMeters() {
  const raw = state._behaviorRaw;
  if (!raw) return;

  // Hesitation: average pause duration (0 = instant, 100% = 10s+ avg)
  let hesitation = 0;
  if (raw.pauseDurations.length > 0) {
    const avg = raw.pauseDurations.reduce((a, b) => a + b, 0) / raw.pauseDurations.length;
    hesitation = Math.min(1, avg / 10000); // 10s = max
  }

  // Retreat rate: retreats / total moves
  const totalMoves = raw.moveTimestamps.length || 1;
  const retreatRate = Math.min(1, raw.retreatCount / totalMoves);

  // Obedience: trial pass rate (starts at 50% if no trials yet)
  let obedience = 0.5;
  const trials = raw.trialTimings;
  if (trials.length > 0) {
    const passed = trials.filter(t => t.passed).length;
    obedience = passed / trials.length;
  }

  // Update DOM
  const h = document.getElementById('meter-hesitation');
  const r = document.getElementById('meter-retreat');
  const o = document.getElementById('meter-obedience');
  if (h) h.style.width = `${(hesitation * 100).toFixed(0)}%`;
  if (r) r.style.width = `${(retreatRate * 100).toFixed(0)}%`;
  if (o) o.style.width = `${(obedience * 100).toFixed(0)}%`;
}

// Hook into DOMContentLoaded
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', relocateEyeToSidebar);
} else {
  setTimeout(relocateEyeToSidebar, 50);
}


// ═══════════════════════════════════════════════════════════════
// CLI RUNTIME SHELL HELPERS
// ═══════════════════════════════════════════════════════════════
function syncCliRuntimeShell() {
  const session = document.getElementById('session-num');
  const seal = document.getElementById('exit-seals');
  const sealChip = document.getElementById('seal-chip');
  if (session) {
    const hasSession = session.textContent.trim().length > 0;
    session.classList.toggle('hidden', !hasSession);
  }
  if (seal && sealChip) {
    const hasSeal = !seal.classList.contains('hidden') && seal.textContent.trim().length > 0;
    sealChip.classList.toggle('hidden', !hasSeal);
  }
}

function syncCliThreatState() {
  const hearts = Array.from(document.querySelectorAll('#hp-display .heart'));
  const activeHearts = hearts.filter(heart => !heart.classList.contains('lost') && heart.textContent.trim() !== '♡').length;
  document.body.classList.toggle('hp-critical', activeHearts <= 1);
  document.body.classList.toggle('hp-warning', activeHearts === 2);
  document.body.classList.toggle('hp-stable', activeHearts >= 3);
}

function decorateCliActionLists() {
  const decorate = (selector, attr) => {
    document.querySelectorAll(selector).forEach((el, idx) => {
      el.setAttribute(attr, String(idx + 1).padStart(2, '0'));
    });
  };
  decorate('#choice-area .choice-btn', 'data-route-index');
  decorate('#event-choices .event-btn', 'data-action-index');
  decorate('#auth-choices .auth-btn', 'data-action-index');
  document.querySelectorAll('#auth-choices .auth-btn, #auth-skip .auth-btn').forEach((btn, idx) => {
    btn.dataset.actionIndex = String(idx + 1).padStart(2, '0');
  });

  document.querySelectorAll('#choice-area .choice-btn').forEach(btn => {
    const dir = btn.dataset.dir;
    if (!dir) return;
    const hintMap = {
      up: 'trace // 向前推进',
      down: 'trace // 深入下层',
      left: 'trace // 切向左侧',
      right: 'trace // 切向右侧',
    };
    btn.dataset.routeState = 'live';
    if (!btn.classList.contains('back-btn')) {
      btn.dataset.routeHint = hintMap[dir] || 'trace // 执行移动';
    }
    if (btn.classList.contains('back-btn')) {
      btn.dataset.routeHint = 'return // 回退上一节点';
      btn.dataset.routeState = 'backtrack';
    }
    if (btn.classList.contains('danger')) {
      btn.dataset.routeHint = 'scramble // 信号失真';
      btn.dataset.routeState = 'scrambled';
    }
    if (btn.classList.contains('shadow-warn')) {
      btn.dataset.routeHint = 'warning // 影子追踪中';
      btn.dataset.routeState = 'blocked';
    }
  });
}

function classifyCliLogs() {
  const entries = document.querySelectorAll('#event-log .log-entry');
  entries.forEach((entry, idx) => {
    const text = entry.textContent.replace(/\s+/g, ' ').trim();
    let type = 'system';
    let prefix = 'sys';
    if (entry.classList.contains('ambient')) {
      type = 'trace';
      prefix = 'trace';
    } else if (entry.classList.contains('danger') || /HP|-1|错误|锁定|受罚|危险|警报|墙壁|影子/.test(text)) {
      type = 'alert';
      prefix = 'alert';
    } else if (/考验|challenge|trial|响应|通过|回答|上帝之手|退后一步/.test(text)) {
      type = 'challenge';
      prefix = 'trial';
    } else if (/AI|它|你在|还在走|出口/.test(text)) {
      type = 'agent';
      prefix = 'agent';
    }
    entry.dataset.logType = type;
    entry.dataset.logPrefix = prefix;
    entry.style.setProperty('--log-order', String(Math.max(0, 40 - idx)));
  });
}

function syncCliEmptyStates() {
  const choiceArea = document.getElementById('choice-area');
  const eventChoices = document.getElementById('event-choices');
  const eventText = document.getElementById('event-text');
  const evidence = document.getElementById('minigame-evidence');
  if (choiceArea) choiceArea.dataset.empty = choiceArea.children.length === 0 ? 'true' : 'false';
  if (eventChoices) eventChoices.dataset.empty = eventChoices.children.length === 0 ? 'true' : 'false';
  if (eventText) eventText.dataset.empty = eventText.textContent.trim() ? 'false' : 'true';
  if (evidence) evidence.dataset.empty = evidence.classList.contains('visible') && evidence.textContent.trim() ? 'false' : 'true';
}

function pulseRuntimeSurface(selector, cls = 'runtime-refresh') {
  const el = document.querySelector(selector);
  if (!el) return;
  el.classList.remove(cls);
  void el.offsetWidth;
  el.classList.add(cls);
  setTimeout(() => el.classList.remove(cls), 520);
}

function initCliShellObservers() {
  const choiceArea = document.getElementById('choice-area');
  const eventChoices = document.getElementById('event-choices');
  const statusBar = document.getElementById('status-bar');
  const eventLog = document.getElementById('event-log');
  const hpDisplay = document.getElementById('hp-display');
  [choiceArea, eventChoices, statusBar, eventLog].filter(Boolean).forEach(node => {
    const observer = new MutationObserver(() => {
      syncCliRuntimeShell();
      syncCliThreatState();
      decorateCliActionLists();
      classifyCliLogs();
      syncCliEmptyStates();
    });
    observer.observe(node, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['class'] });
  });
  if (choiceArea) {
    new MutationObserver(() => pulseRuntimeSurface('#choice-area-wrap')).observe(choiceArea, { childList: true });
  }
  if (eventChoices) {
    new MutationObserver(() => pulseRuntimeSurface('#event-box', 'runtime-press')).observe(eventChoices, { childList: true });
  }
  if (statusBar) {
    new MutationObserver(() => pulseRuntimeSurface('#status-bar')).observe(statusBar, { childList: true, subtree: true, characterData: true });
  }
  if (hpDisplay) {
    new MutationObserver(syncCliThreatState).observe(hpDisplay, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['class'] });
  }
  syncCliRuntimeShell();
  syncCliThreatState();
  decorateCliActionLists();
  classifyCliLogs();
  syncCliEmptyStates();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initCliShellObservers);
} else {
  setTimeout(initCliShellObservers, 50);
}
