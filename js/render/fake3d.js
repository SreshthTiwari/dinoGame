// Fake-3D renderer: the 2D canvas with perspective applied by hand (a chase camera behind and
// above the dino). World x runs across the road and y along it, the dino sits at y = PY.
import { LANES, PY } from '../game.js';

export const FAKE3D_DEFAULTS = { horizon: 140, back: 350, follow: 0.35 };
// horizon = screen y of the horizon, back = how far behind the dino the camera sits (smaller =
// stronger perspective), follow = how much the camera drifts sideways with the dino (0 = fixed)
const SLIDERS = [
  { key: 'back', label: 'Distance', min: 120, max: 900, step: 10 },
  { key: 'horizon', label: 'Horizon', min: 40, max: 400, step: 5 },
  { key: 'follow', label: 'Follow', min: 0, max: 1, step: 0.05 },
];

export function createFake3D(canvas) {
  const ctx = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;
  const cam = { ...FAKE3D_DEFAULTS };
  let camX = W / 2, v = null;          // world x the camera looks along; the current view
  const stars = Array.from({ length: 40 }, () => ({ x: Math.random() * W, y: Math.random() * H, s: Math.random() * 2 + 0.5 }));

  // Chase-camera projection. World x runs across the road and y along it (the player sits at
  // y = PY, where s = 1). s shrinks toward the horizon, so far things are smaller and higher up.
  function project(wx, wy) {
    const s = cam.back / (cam.back + PY - wy);
    return { x: W / 2 + (wx - camX) * s, y: cam.horizon + (PY - cam.horizon) * s, s };
  }
  // draw fn(ctx) at world (wx, wy), scaled by perspective and faded into the distance
  function inWorld(wx, wy, fn) {
    if (wy > PY + cam.back * 0.5) return;
    const p = project(wx, wy);
    if (p.y > H + 120) return;
    ctx.save();
    ctx.globalAlpha = Math.min(1, Math.max(0, (p.s - 0.2) / 0.25));
    ctx.translate(p.x, p.y); ctx.scale(p.s, p.s);
    fn();
    ctx.restore();
  }

  function drawBlock() {
    const x = 0, y = 0;
    ctx.fillStyle = 'rgba(0,0,0,0.35)'; ctx.fillRect(x - 36, y - 6, 72, 26);
    ctx.fillStyle = '#ff5d8f';
    for (let i = 0; i < 3; i++) {
      const bx = x - 33 + i * 22;
      ctx.beginPath(); ctx.moveTo(bx, y + 14); ctx.lineTo(bx + 11, y - 14); ctx.lineTo(bx + 22, y + 14); ctx.fill();
    }
    ctx.fillStyle = '#ffa3c0';
    for (let i = 0; i < 3; i++) ctx.fillRect(x - 24 + i * 22, y - 2, 4, 4);
  }

  function drawBeam() {
    const x = 0, y = 0;
    ctx.fillStyle = 'rgba(0,0,0,0.35)'; ctx.fillRect(x - 40, y + 4, 80, 20); // shadow on the floor
    ctx.fillStyle = '#7a5cff';                                              // posts
    ctx.fillRect(x - 42, y - 10, 10, 24); ctx.fillRect(x + 32, y - 10, 10, 24);
    ctx.fillStyle = '#ffd35e';                                              // bar, raised overhead
    ctx.fillRect(x - 44, y - 16, 88, 12);
    ctx.fillStyle = '#e0a82e';
    for (let i = 0; i < 6; i++) ctx.fillRect(x - 42 + i * 15, y - 16, 7, 12);
  }

  function drawPlayer() {
    const duck = v.player.ducking;
    const sc = 1 + v.player.z / 260 - (duck ? 0.3 : 0);
    const x = project(v.player.x, PY).x, y = PY - v.player.z * 0.45;
    // shadow stays on the floor, shrinks as you rise
    ctx.fillStyle = 'rgba(0,0,0,0.4)';
    const ss = Math.max(0.5, 1 - v.player.z / 250);
    ctx.beginPath(); ctx.ellipse(x, PY + 6, 20 * ss, 14 * ss, 0, 0, 7); ctx.fill();

    ctx.save(); ctx.translate(x, y); ctx.scale(sc, sc);
    const run = v.player.z === 0 && v.state === 'play' ? Math.sin(v.phase * 22) : 0;   // legs and tail follow the speed
    const wag = Math.sin(v.phase * 9) * 7;
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

  function draw(view) {
    v = view;
    camX = W / 2 + (v.player.x - W / 2) * cam.follow;
    const vx = project(camX, -1e6).x;                         // vanishing point

    // sky, with stars, fading to a glow at the horizon
    const sky = ctx.createLinearGradient(0, 0, 0, cam.horizon);
    sky.addColorStop(0, '#0e0b1f'); sky.addColorStop(1, '#2d1a6b');
    ctx.fillStyle = sky; ctx.fillRect(0, 0, W, cam.horizon);
    for (const st of stars) { ctx.fillStyle = 'rgba(255,255,255,0.35)'; ctx.fillRect(st.x, (st.y / H) * cam.horizon * 0.9, st.s, st.s); }

    // ground: a grid that scrolls toward the camera, so speed reads
    ctx.fillStyle = '#0e0b1f'; ctx.fillRect(0, cam.horizon, W, H - cam.horizon);
    ctx.lineWidth = 1;
    for (let k = -8; k <= 8; k++) {
      const a = project(W / 2 + k * 120, PY - 3000), c = project(W / 2 + k * 120, PY + 200);
      ctx.strokeStyle = 'rgba(122,92,255,0.18)';
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(c.x, c.y); ctx.stroke();
    }
    const off = v.scroll % 60;
    for (let wy = 780 + off - 60; wy > PY - 3000; wy -= 60) {
      const p = project(0, wy);
      ctx.strokeStyle = `rgba(122,92,255,${Math.min(0.25, p.s * 0.3)})`;
      ctx.beginPath(); ctx.moveTo(0, p.y); ctx.lineTo(W, p.y); ctx.stroke();
    }

    // road
    const rl = LANES[0] - 60, rr = LANES[2] + 60;
    const [fl, fr, nl, nr] = [project(rl, PY - 3000), project(rr, PY - 3000), project(rl, PY + 200), project(rr, PY + 200)];
    ctx.fillStyle = '#1b1040';
    ctx.beginPath(); ctx.moveTo(fl.x, fl.y); ctx.lineTo(fr.x, fr.y); ctx.lineTo(nr.x, nr.y); ctx.lineTo(nl.x, nl.y); ctx.fill();
    ctx.strokeStyle = '#5ef2c8'; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(fl.x, fl.y); ctx.lineTo(nl.x, nl.y); ctx.moveTo(fr.x, fr.y); ctx.lineTo(nr.x, nr.y); ctx.stroke();
    ctx.fillStyle = '#3a2a7a';
    for (const lx of [(LANES[0] + LANES[1]) / 2, (LANES[1] + LANES[2]) / 2])
      for (let wy = 780 + off - 60; wy > PY - 3000; wy -= 60) {
        const a = project(lx, wy), c = project(lx, wy - 30);   // dash from wy back to wy - 30
        ctx.beginPath();
        ctx.moveTo(a.x - 2 * a.s, a.y); ctx.lineTo(a.x + 2 * a.s, a.y); ctx.lineTo(c.x + 2 * c.s, c.y); ctx.lineTo(c.x - 2 * c.s, c.y); ctx.fill();
      }

    // haze at the horizon hides where the road ends
    const haze = ctx.createLinearGradient(0, cam.horizon, 0, cam.horizon + 90);
    haze.addColorStop(0, 'rgba(45,26,107,1)'); haze.addColorStop(1, 'rgba(45,26,107,0)');
    ctx.fillStyle = haze; ctx.fillRect(0, cam.horizon, W, 90);

    const far2near = (a, b) => a.y - b.y;                     // smaller y = farther away = draw first
    v.obstacles.filter(o => o.kind === 'block').sort(far2near).forEach(o => inWorld(LANES[o.lane], o.y, drawBlock));
    drawPlayer();
    v.obstacles.filter(o => o.kind === 'beam').sort(far2near).forEach(o => inWorld(LANES[o.lane], o.y, drawBeam));   // overhead, so drawn over the player
  }

  return { name: 'fake3d', cam, defaults: FAKE3D_DEFAULTS, sliders: SLIDERS, activate() {}, deactivate() {}, draw };
}
