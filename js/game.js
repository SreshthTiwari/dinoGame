const LANES = [120, 240, 360];
const PY = 590;                      // player's screen y
const GRAVITY = 1800, JUMP_V = 640;
const BLOCK_CLEAR = 30;              // must be at least this high to hop a block
const START_SPEED = 300, ACCEL = 3;  // gentler than keyboard-only so body controls have time to react

// canStart() lets the app hold back a start request (e.g. until the camera is calibrated)
export function createGame(canvas, { canStart = () => true } = {}) {
  const ctx = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;

  let state = 'start', player, obstacles, score, speed, spawnIn, t = 0, scroll = 0;
  let best = +(localStorage.getItem('blip-td-best') || 0);
  const duckSources = {};              // keyboard and pose each hold their own duck flag
  const duckHeld = () => Object.values(duckSources).some(Boolean);
  const stars = Array.from({ length: 40 }, () => ({ x: Math.random() * W, y: Math.random() * H, s: Math.random() * 2 + 0.5 }));

  function newPlayer() { return { lane: 1, x: LANES[1], z: 0, vz: 0, duckT: 0 }; }
  player = newPlayer(); obstacles = []; score = 0; speed = START_SPEED;

  function reset() {
    player = newPlayer(); obstacles = [];
    score = 0; speed = START_SPEED; spawnIn = 1.5; state = 'play';
  }
  function start() { if (state !== 'play' && canStart()) reset(); }

  function jump() {
    if (state !== 'play') return start();
    if (player.z === 0) player.vz = JUMP_V;
  }
  function move(d) {
    if (state !== 'play') return start();
    player.lane = Math.max(0, Math.min(2, player.lane + d));
  }
  function setLane(lane) {
    if (state === 'play') player.lane = Math.max(0, Math.min(2, lane));
  }
  function duckFor(seconds) {
    if (state === 'play') player.duckT = seconds; else start();
  }
  function setDuckHeld(held, source = 'keys') { duckSources[source] = held; }
  const isPlaying = () => state === 'play';

  const ducking = () => player.z === 0 && (duckHeld() || player.duckT > 0);

  function spawn() {
    const lanes = [0, 1, 2].sort(() => Math.random() - 0.5).slice(0, Math.random() < 0.15 ? 2 : 1);
    for (const l of lanes) obstacles.push({ lane: l, y: -60, kind: Math.random() < 0.45 ? 'beam' : 'block' });
    spawnIn = Math.max(0.9, 2.0 - speed / 1000) + Math.random();
  }

  function update(dt) {
    t += dt;
    if (state !== 'play') { scroll += 40 * dt; return; }
    scroll += speed * dt;

    player.x += (LANES[player.lane] - player.x) * Math.min(1, dt * 18);
    player.duckT = Math.max(0, player.duckT - dt);
    if (player.z > 0 || player.vz > 0) {
      player.vz -= GRAVITY * dt;
      if (duckHeld()) player.vz -= 1800 * dt;
      player.z += player.vz * dt;
      if (player.z <= 0) { player.z = 0; player.vz = 0; }
    }

    speed += ACCEL * dt;
    score += speed * dt / 12;
    spawnIn -= dt;
    if (spawnIn <= 0) spawn();

    for (const o of obstacles) o.y += speed * dt;
    obstacles = obstacles.filter(o => o.y < H + 80);

    const duck = ducking();
    for (const o of obstacles) {
      if (Math.abs(o.y - PY) > 26 || Math.abs(LANES[o.lane] - player.x) > 36) continue;
      const hit = o.kind === 'block' ? player.z < BLOCK_CLEAR : !duck;
      if (hit) {
        state = 'dead';
        if (score > best) { best = Math.floor(score); localStorage.setItem('blip-td-best', best); }
      }
    }
  }

  function drawBlock(o) {
    const x = LANES[o.lane], y = o.y;
    ctx.fillStyle = 'rgba(0,0,0,0.35)'; ctx.fillRect(x - 36, y - 6, 72, 26);
    ctx.fillStyle = '#ff5d8f';
    for (let i = 0; i < 3; i++) {
      const bx = x - 33 + i * 22;
      ctx.beginPath(); ctx.moveTo(bx, y + 14); ctx.lineTo(bx + 11, y - 14); ctx.lineTo(bx + 22, y + 14); ctx.fill();
    }
    ctx.fillStyle = '#ffa3c0';
    for (let i = 0; i < 3; i++) ctx.fillRect(x - 24 + i * 22, y - 2, 4, 4);
  }

  function drawBeam(o) {
    const x = LANES[o.lane], y = o.y;
    ctx.fillStyle = 'rgba(0,0,0,0.35)'; ctx.fillRect(x - 40, y + 4, 80, 20); // shadow on the floor
    ctx.fillStyle = '#7a5cff';                                              // posts
    ctx.fillRect(x - 42, y - 10, 10, 24); ctx.fillRect(x + 32, y - 10, 10, 24);
    ctx.fillStyle = '#ffd35e';                                              // bar, raised overhead
    ctx.fillRect(x - 44, y - 16, 88, 12);
    ctx.fillStyle = '#e0a82e';
    for (let i = 0; i < 6; i++) ctx.fillRect(x - 42 + i * 15, y - 16, 7, 12);
  }

  function drawPlayer() {
    const duck = ducking();
    const sc = 1 + player.z / 260 - (duck ? 0.3 : 0);
    const x = player.x, y = PY - player.z * 0.45;
    // shadow stays on the floor, shrinks as you rise
    ctx.fillStyle = 'rgba(0,0,0,0.4)';
    const ss = Math.max(0.5, 1 - player.z / 250);
    ctx.beginPath(); ctx.ellipse(x, PY + 6, 20 * ss, 14 * ss, 0, 0, 7); ctx.fill();

    ctx.save(); ctx.translate(x, y); ctx.scale(sc, sc);
    const run = player.z === 0 && state === 'play' ? Math.sin(t * 22) : 0;
    const wag = Math.sin(t * 9) * 7;
    const body = duck ? '#3fc9a5' : '#5ef2c8', dark = '#2bb894';
    ctx.fillStyle = dark;                                     // tail, wagging
    ctx.beginPath(); ctx.moveTo(-9, 12); ctx.quadraticCurveTo(wag * 0.5, 24, wag, 38); ctx.quadraticCurveTo(wag * 0.5 + 3, 24, 9, 12); ctx.fill();
    ctx.fillRect(-21, -4 + run * 5, 8, 11); ctx.fillRect(13, -4 - run * 5, 8, 11);  // feet
    ctx.fillStyle = body;                                     // body from above
    ctx.beginPath(); ctx.ellipse(0, 2, 16, 20, 0, 0, 7); ctx.fill();
    ctx.fillStyle = '#ff5d8f';                                // back plates along the spine
    for (let i = 0; i < 4; i++) {
      const py = -6 + i * 7, w = 5 - i * 0.6;
      ctx.beginPath(); ctx.moveTo(0, py - 4); ctx.lineTo(w, py); ctx.lineTo(0, py + 4); ctx.lineTo(-w, py); ctx.fill();
    }
    ctx.fillStyle = body;                                     // head + snout
    ctx.beginPath(); ctx.ellipse(0, -21, 11, 12, 0, 0, 7); ctx.fill();
    ctx.beginPath(); ctx.roundRect(-7, -38, 14, 14, 6); ctx.fill();
    ctx.fillStyle = dark; ctx.fillRect(-4, -35, 2, 3); ctx.fillRect(2, -35, 2, 3);  // nostrils
    ctx.fillStyle = '#fff';                                   // eyes
    ctx.beginPath(); ctx.arc(-7, -22, 4, 0, 7); ctx.arc(7, -22, 4, 0, 7); ctx.fill();
    ctx.fillStyle = '#0e0b1f';
    ctx.beginPath(); ctx.arc(-7, -23, 2, 0, 7); ctx.arc(7, -23, 2, 0, 7); ctx.fill();
    ctx.restore();
  }

  function draw() {
    ctx.fillStyle = '#0e0b1f'; ctx.fillRect(0, 0, W, H);
    for (const s of stars) { ctx.fillStyle = 'rgba(255,255,255,0.3)'; ctx.fillRect(s.x, (s.y + scroll * s.s * 0.2) % H, s.s, s.s); }

    // road
    const rx = LANES[0] - 60, rw = LANES[2] - LANES[0] + 120;
    ctx.fillStyle = '#1b1040'; ctx.fillRect(rx, 0, rw, H);
    ctx.fillStyle = '#5ef2c8'; ctx.fillRect(rx - 3, 0, 3, H); ctx.fillRect(rx + rw, 0, 3, H);
    ctx.fillStyle = '#3a2a7a';
    const off = scroll % 60;
    for (const lx of [(LANES[0] + LANES[1]) / 2, (LANES[1] + LANES[2]) / 2])
      for (let y = -60 + off; y < H; y += 60) ctx.fillRect(lx - 2, y, 4, 30);

    obstacles.filter(o => o.kind === 'block').forEach(drawBlock);
    drawPlayer();
    obstacles.filter(o => o.kind === 'beam').forEach(drawBeam);   // overhead, so drawn over the player

    ctx.fillStyle = '#e8e4ff'; ctx.font = 'bold 20px monospace'; ctx.textAlign = 'right';
    ctx.fillText(String(Math.floor(score)).padStart(5, '0'), W - 16, 30);
    ctx.fillStyle = '#8c82c8'; ctx.textAlign = 'left';
    ctx.fillText('HI ' + String(best).padStart(5, '0'), 16, 30);

    ctx.textAlign = 'center';
    if (state === 'start') {
      ctx.fillStyle = '#e8e4ff'; ctx.font = 'bold 40px monospace'; ctx.fillText('BLIP DASH', W / 2, 200);
      ctx.font = '15px monospace'; ctx.fillStyle = '#8c82c8';
      ctx.fillText('LEFT / RIGHT = switch lane', W / 2, 240);
      ctx.fillText('SPACE / UP = jump (spikes)', W / 2, 264);
      ctx.fillText('DOWN = duck (gates)', W / 2, 288);
      ctx.fillText('press space to start', W / 2, 330);
      ctx.fillText('C = recalibrate camera  Esc = keyboard only', W / 2, 360);
    } else if (state === 'dead') {
      ctx.fillStyle = '#ff5d8f'; ctx.font = 'bold 40px monospace'; ctx.fillText('ZAPPED', W / 2, 240);
      ctx.fillStyle = '#8c82c8'; ctx.font = '16px monospace'; ctx.fillText('space to retry', W / 2, 275);
    }
  }

  return { update, draw, start, jump, move, setLane, duckFor, setDuckHeld, isPlaying };
}
