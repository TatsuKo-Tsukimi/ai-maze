// ═══════════════════════════════════════════════════════════════
// PARTICLE SYSTEM — floating dust/ash on the corridor
// ═══════════════════════════════════════════════════════════════
const particles = (() => {
  let canvas = null;
  let pCtx = null;
  let _particles = [];
  let _raf = null;
  let _depth = 0;

  // Theme colors for particles
  const THEME_COLORS = {
    normal:  'rgba(74,158,255,0.3)',
    lure:    'rgba(255,215,0,0.3)',
    danger:  'rgba(255,71,87,0.3)',
    eerie:   'rgba(80,227,194,0.3)',
  };
  let _color = THEME_COLORS.normal;

  function init() {
    canvas = document.getElementById('particle-canvas');
    if (!canvas) return;
    pCtx = canvas.getContext('2d');
    _resize();
    window.addEventListener('resize', _resize);
    _spawnInitial();
    _loop();
  }

  function _resize() {
    if (!canvas) return;
    const rect = canvas.parentElement.getBoundingClientRect();
    canvas.width = rect.width;
    canvas.height = rect.height;
  }

  function _spawnInitial() {
    const count = 12 + Math.floor(_depth * 1.5);
    _particles = [];
    for (let i = 0; i < Math.min(count, 40); i++) {
      _particles.push(_makeParticle());
    }
  }

  function _makeParticle() {
    return {
      x: Math.random() * (canvas ? canvas.width : 640),
      y: Math.random() * (canvas ? canvas.height : 360),
      vx: (Math.random() - 0.5) * 0.3,
      vy: -0.1 - Math.random() * 0.2,
      size: 1 + Math.random() * 1.5,
      alpha: 0.15 + Math.random() * 0.25,
      life: 200 + Math.random() * 300,
      age: 0,
    };
  }

  function _loop() {
    if (!pCtx || !canvas) return;
    pCtx.clearRect(0, 0, canvas.width, canvas.height);

    // Maintain particle count based on depth
    const target = Math.min(12 + Math.floor(_depth * 1.5), 40);
    while (_particles.length < target) _particles.push(_makeParticle());

    for (let i = _particles.length - 1; i >= 0; i--) {
      const p = _particles[i];
      p.x += p.vx + (Math.random() - 0.5) * 0.15;
      p.y += p.vy;
      p.age++;

      const lifeRatio = p.age / p.life;
      const alpha = p.alpha * (lifeRatio < 0.1 ? lifeRatio * 10 : lifeRatio > 0.8 ? (1 - lifeRatio) * 5 : 1);

      if (p.age > p.life || p.y < -5 || p.x < -5 || p.x > canvas.width + 5) {
        _particles[i] = _makeParticle();
        _particles[i].y = canvas.height + 5;
        continue;
      }

      pCtx.beginPath();
      pCtx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
      pCtx.fillStyle = _color.replace(/[\d.]+\)$/, alpha + ')');
      pCtx.fill();
    }

    _raf = requestAnimationFrame(_loop);
  }

  function updateDepth(depth) {
    _depth = depth;
  }

  let _hpOverride = null;

  function setTheme(type) {
    if (_hpOverride) { _color = _hpOverride; return; }
    if (type === 'blocker') _color = THEME_COLORS.danger;
    else if (type === 'lure') _color = THEME_COLORS.lure;
    else if (type === 'drain') _color = THEME_COLORS.eerie;
    else _color = THEME_COLORS.normal;
  }

  function onHpChange(hp) {
    if (hp <= 1) {
      _hpOverride = 'rgba(200,40,40,0.4)';  // red particles at HP 1
      _color = _hpOverride;
    } else if (hp <= 2) {
      _hpOverride = 'rgba(200,150,50,0.3)';  // amber at HP 2
      _color = _hpOverride;
    } else {
      _hpOverride = null;
    }
  }

  function destroy() {
    if (_raf) cancelAnimationFrame(_raf);
    _raf = null;
  }

  return { init, updateDepth, setTheme, onHpChange, destroy };
})();
