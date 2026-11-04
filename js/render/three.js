// Real 3D renderer (three.js) with a chase camera. Loaded lazily (see main.js), so the 1.2 MB
// library only downloads if you switch to it. Same view snapshot as the fake-3D renderer.
//
// Scene units are the game's pixels. Game world (x across, y along the road, dino at y = PY)
// maps to scene (x - 240, up, y - PY): the dino sits at the origin facing -z, away from the
// camera, and obstacles come toward +z.
import * as THREE from '../../vendor/three/three.module.js';
import { LANES, PY } from '../game.js';
import { THEMES, THEME_ORDER, DEFAULT_THEME, AUTO, blendTheme } from './themes.js';

export const THREE_DEFAULTS = { height: 260, distance: 480, lookAhead: 400, fov: 60, follow: 0.6 };
// height / distance = where the camera sits above / behind the dino, lookAhead = how far down the
// road it aims, fov = lens, follow = how much the camera drifts sideways with the dino
const SLIDERS = [
  { key: 'height', label: 'Height', min: 60, max: 600, step: 10 },
  { key: 'distance', label: 'Distance', min: 150, max: 900, step: 10 },
  { key: 'lookAhead', label: 'Look ahead', min: 100, max: 1200, step: 20 },
  { key: 'fov', label: 'FOV', min: 30, max: 100, step: 1 },
  { key: 'follow', label: 'Follow', min: 0, max: 1, step: 0.05 },
];

const CX = LANES[1];                 // x of the middle lane
const ROAD_W = LANES[2] - LANES[0] + 120, FAR = 3000, NEAR = 400;
const JUMP_VIS = 0.8;                // scene units of height per unit of game jump height
const DINO_SCALE = 1.4;
// ducking dips the head and neck forward and down (the body stays put). Standing, the head is
// above a gate's bar; ducked, it is below it.
const DUCK_ANGLE = -1.2;             // radians the neck pitches forward-down at full duck
const DUCK_CROUCH = 3;               // how far the whole body sinks (model units)
const DUCK_SPEED = 18;               // how fast the duck eases in and out (per second)

// a small canvas drawn once, used as a repeating texture
function canvasTexture(w, h, paint, repeatX, repeatY, renderer) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  paint(c.getContext('2d'), w, h);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(repeatX, repeatY);
  tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
  return tex;
}

// redraw a canvas texture in place (used when the theme changes)
function repaint(tex, paint) {
  const c = tex.image;
  paint(c.getContext('2d'), c.width, c.height);
  tex.needsUpdate = true;
}

// sky: a vertical gradient, plus optional stars and a setting sun. It is a screen-space background,
// so the sun sits at a fixed height on screen, about where the horizon is with the default camera.
function paintSky(g, w, h, t) {
  const { top, mid, horizon, stars, sun } = t.sky;
  const gr = g.createLinearGradient(0, 0, 0, h);
  gr.addColorStop(0, top);
  if (mid) gr.addColorStop(0.24, mid);
  gr.addColorStop(0.42, horizon); gr.addColorStop(1, horizon);
  g.fillStyle = gr; g.fillRect(0, 0, w, h);
  if (stars) {
    let seed = 7;                                    // fixed seed: the same stars every time
    const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    for (let i = 0; i < stars; i++) {
      g.fillStyle = `rgba(255,255,255,${0.25 + rnd() * 0.5})`;
      const r = 0.5 + rnd() * 1.2;
      g.fillRect(rnd() * w, rnd() * h * 0.34, r, r);
    }
  }
  if (sun) {
    const x = w / 2, y = h * 0.38, r = w * 0.15;
    const glow = g.createRadialGradient(x, y, r * 0.6, x, y, r * 3);
    glow.addColorStop(0, sun.glow + 'cc'); glow.addColorStop(1, sun.glow + '00');
    g.globalAlpha = sun.alpha ?? 1;                  // fades in / out while one theme blends into another
    g.fillStyle = glow; g.fillRect(0, 0, w, h);
    g.fillStyle = sun.color; g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
    g.globalAlpha = 1;
  }
}

export function createThree(canvas2d, stage) {
  const W = canvas2d.width, H = canvas2d.height;
  const ctx2d = canvas2d.getContext('2d');
  const cam = { ...THREE_DEFAULTS };

  const canvas = document.createElement('canvas');
  canvas.id = 'c3d';
  stage.insertBefore(canvas, canvas2d);          // under the 2D canvas, which still draws the HUD
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
  renderer.setSize(W, H, false);

  const scene = new THREE.Scene();
  const sky = canvasTexture(256, 384, () => {}, 1, 1, renderer);       // painted by applyTheme(); same 2:3 shape as the screen
  sky.wrapS = sky.wrapT = THREE.ClampToEdgeWrapping;
  scene.background = sky;
  scene.fog = new THREE.Fog(0x000000, 700, 2300);

  const ambient = new THREE.AmbientLight(0xffffff, 0.9);
  scene.add(ambient);
  const sun = new THREE.DirectionalLight(0xffffff, 1.1);
  sun.position.set(150, 400, 250);
  scene.add(sun);

  const camera = new THREE.PerspectiveCamera(cam.fov, W / H, 10, FAR + 600);
  let lastFov = cam.fov;

  // ground grid and road: flat planes whose textures scroll toward the camera
  const flat = (w, len, tex, y) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, len), new THREE.MeshBasicMaterial({ map: tex }));
    m.rotation.x = -Math.PI / 2;
    m.position.set(0, y, (NEAR - FAR) / 2);
    scene.add(m);
    return m;
  };
  const LEN = FAR + NEAR, GRID = 120, DASH = 60;
  const paintGround = t => (g, w, h) => {
    g.fillStyle = t.ground; g.fillRect(0, 0, w, h);
    g.strokeStyle = t.grid; g.lineWidth = 3; g.strokeRect(0, 0, w, h);
  };
  const paintRoad = t => (g, w, h) => {
    g.fillStyle = t.road; g.fillRect(0, 0, w, h);
    g.fillStyle = t.dash;
    for (const lx of [(LANES[0] + LANES[1]) / 2, (LANES[1] + LANES[2]) / 2])    // dashes between the lanes
      g.fillRect(w / 2 + lx - CX - 2, 0, 4, h / 2);
  };
  const groundTex = canvasTexture(128, 128, () => {}, 4000 / GRID, LEN / GRID, renderer);
  flat(4000, LEN, groundTex, -0.5);
  const roadTex = canvasTexture(ROAD_W, DASH, () => {}, 1, LEN / DASH, renderer);
  flat(ROAD_W, LEN, roadTex, 0);
  const edge = new THREE.MeshBasicMaterial();
  for (const sx of [-1, 1]) {
    const e = new THREE.Mesh(new THREE.BoxGeometry(5, 3, LEN), edge);
    e.position.set(sx * ROAD_W / 2, 1.5, (NEAR - FAR) / 2);
    scene.add(e);
  }

  // ---- the dino: built from simple shapes, facing -z so the camera sees its back ----
  const mat = c => new THREE.MeshLambertMaterial({ color: c });
  const bodyMat = mat(0xffffff), darkMat = mat(0xffffff), pinkMat = mat(0xffffff);   // coloured by the theme
  const dino = new THREE.Group();
  const model = new THREE.Group();               // the dino as a unit (sinks a little when ducking)
  dino.add(model);
  const add = (parent, geo, material, x, y, z) => {
    const m = new THREE.Mesh(geo, material); m.position.set(x, y, z); parent.add(m); return m;
  };
  const body = add(model, new THREE.SphereGeometry(1, 20, 14), bodyMat, 0, 16, 0);
  body.scale.set(16, 13, 22);
  // neck + head hang off a pivot at the front of the body, so ducking is just rotating the pivot
  const neck = new THREE.Group();
  neck.position.set(0, 20, -16);
  model.add(neck);
  const stalk = add(neck, new THREE.CylinderGeometry(5.5, 7.5, 17.5, 10), bodyMat, 0, 8, -3.5);
  stalk.rotation.x = -Math.atan(7 / 16);           // leans forward, away from the camera
  add(neck, new THREE.SphereGeometry(11, 16, 12), bodyMat, 0, 16, -7);          // head
  add(neck, new THREE.BoxGeometry(14, 10, 14), bodyMat, 0, 13, -18);            // snout
  for (const sx of [-1, 1]) {
    add(neck, new THREE.SphereGeometry(3.6, 10, 8), mat(0xffffff), sx * 7, 20, -13);   // eyes
    add(neck, new THREE.SphereGeometry(1.8, 8, 6), mat(0x0e0b1f), sx * 7, 20, -16);
  }
  for (let i = 0; i < 4; i++) {                    // back plates along the spine (low enough to clear a gate)
    const p = add(model, new THREE.ConeGeometry(4.2 - i * 0.5, 7, 4), pinkMat, 0, 28.5, -10 + i * 8);
    p.rotation.y = Math.PI / 4;
  }
  const tailPivot = new THREE.Group();             // tail wags around where it joins the body
  tailPivot.position.set(0, 14, 18);
  const tail = add(tailPivot, new THREE.ConeGeometry(7, 30, 8), darkMat, 0, 0, 14);
  tail.rotation.x = Math.PI / 2;                   // tip toward the camera
  model.add(tailPivot);
  const legs = [-1, 1].map(sx => add(model, new THREE.BoxGeometry(8, 12, 10), darkMat, sx * 11, 6, 2));
  dino.scale.setScalar(DINO_SCALE);
  scene.add(dino);

  const shadow = new THREE.Mesh(new THREE.CircleGeometry(20, 20), new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.4 }));
  shadow.rotation.x = -Math.PI / 2; shadow.position.y = 0.6;
  scene.add(shadow);

  // ---- obstacles ----
  const spikeGeo = new THREE.ConeGeometry(12, 22, 4), spikeMat = mat(0xffffff);
  const postGeo = new THREE.BoxGeometry(8, 58, 8), postMat = mat(0xffffff);
  const barGeo = new THREE.BoxGeometry(96, 12, 10);
  const barMat = new THREE.MeshLambertMaterial({ color: 0xffffff });
  function makeBlock() {
    const g = new THREE.Group();
    for (const sx of [-1, 0, 1]) {
      const s = add(g, spikeGeo, spikeMat, sx * 24, 11, 0);
      s.rotation.y = Math.PI / 4;
    }
    return g;
  }
  function makeBeam() {
    const g = new THREE.Group();
    for (const sx of [-1, 1]) add(g, postGeo, postMat, sx * 44, 29, 0);
    add(g, barGeo, barMat, 0, 52, 0);                // bar bottom at 46: the dino has to duck under it
    return g;
  }
  // ---- themes ----
  // `choice` is what the player picked: a theme id, or 'auto' (a new theme every AUTO.seconds of a run).
  // `now` is the theme that is on screen right now (part-way between two while a fade runs) and
  // `targetId` the theme it is heading for.
  let choice = DEFAULT_THEME, targetId = DEFAULT_THEME, now = THEMES[DEFAULT_THEME], fade = null;
  let onThemeChange = null;

  function applyTheme(t) {                           // paint a (possibly blended) theme onto everything
    now = t;
    repaint(sky, (g, w, h) => paintSky(g, w, h, t));
    repaint(groundTex, paintGround(t));
    repaint(roadTex, paintRoad(t));
    scene.fog.color.set(t.fog); scene.fog.near = t.fogNear; scene.fog.far = t.fogFar;
    edge.color.set(t.edge);
    bodyMat.color.set(t.dino.body); darkMat.color.set(t.dino.dark); pinkMat.color.set(t.dino.plates);
    spikeMat.color.set(t.spike); postMat.color.set(t.post);
    barMat.color.set(t.bar); barMat.emissive.set(t.barGlow);
    ambient.color.set(t.light.ambient[0]); ambient.intensity = t.light.ambient[1];
    sun.color.set(t.light.sun[0]); sun.intensity = t.light.sun[1];
  }
  function goTo(id, seconds) {                       // head for theme `id`, fading over `seconds` (0 = at once)
    targetId = id;
    if (seconds > 0) fade = { from: now, to: THEMES[id], k: 0, secs: seconds };
    else { fade = null; applyTheme(THEMES[id]); }
    onThemeChange?.();
  }
  function setTheme(id) {                            // a theme id, or 'auto'
    choice = id === AUTO.id || THEMES[id] ? id : DEFAULT_THEME;
    try { localStorage.setItem('blip-theme', choice); } catch {}
    if (choice !== AUTO.id) goTo(choice, 0.6);
    else onThemeChange?.();                          // auto picks its theme on the next frame, from the run time
  }
  function stepFade(dt) {
    if (!fade) return;
    fade.k = Math.min(1, fade.k + dt / fade.secs);
    const e = fade.k * fade.k * (3 - 2 * fade.k);    // smoothstep: eases in and out
    applyTheme(fade.k >= 1 ? fade.to : blendTheme(fade.from, fade.to, e));
    if (fade.k >= 1) fade = null;
  }
  {
    let saved = null;
    try { saved = localStorage.getItem('blip-theme'); } catch {}
    choice = saved === AUTO.id || THEMES[saved] ? saved : DEFAULT_THEME;
    goTo(choice === AUTO.id ? DEFAULT_THEME : choice, 0);
  }

  const meshes = new Map();                          // game obstacle -> its mesh
  let duck = 0, lastT = 0;                           // eased duck amount; game time of the previous frame

  function draw(v) {
    ctx2d.clearRect(0, 0, W, H);                     // the 2D canvas is transparent here: HUD only

    const dt = Math.min(0.1, Math.max(0, v.t - lastT)); lastT = v.t;
    if (choice === AUTO.id && v.state === 'play') {  // auto: the run time decides the world
      const id = THEME_ORDER[Math.floor(v.elapsed / AUTO.seconds) % THEME_ORDER.length];
      if (id !== targetId) goTo(id, AUTO.fade);
    }
    stepFade(dt);

    groundTex.offset.y = v.scroll / GRID;
    roadTex.offset.y = v.scroll / DASH;

    const p = v.player;
    const px = p.x - CX, lift = p.z * JUMP_VIS;
    const running = p.z === 0 && v.state === 'play';
    const run = running ? Math.sin(v.phase * 22) : 0;
    dino.position.set(px, lift, 0);
    duck += ((p.ducking ? 1 : 0) - duck) * Math.min(1, dt * DUCK_SPEED);     // 0 = standing, 1 = fully ducked
    neck.rotation.x = DUCK_ANGLE * duck;
    neck.position.y = 20 + (running ? Math.abs(run) * 1.5 : 0);
    model.position.y = -DUCK_CROUCH * duck;
    legs[0].position.z = 2 + run * 5; legs[1].position.z = 2 - run * 5;
    tailPivot.rotation.y = Math.sin(v.phase * 9) * 0.35;
    const ss = Math.max(0.5, 1 - p.z / 250);
    shadow.position.x = px; shadow.scale.set(ss * DINO_SCALE, ss * DINO_SCALE, 1);

    const seen = new Set();
    for (const o of v.obstacles) {
      let m = meshes.get(o);
      if (!m) { m = o.kind === 'beam' ? makeBeam() : makeBlock(); scene.add(m); meshes.set(o, m); }
      m.position.set(LANES[o.lane] - CX, 0, o.y - PY);
      seen.add(o);
    }
    for (const [o, m] of meshes) if (!seen.has(o)) { scene.remove(m); meshes.delete(o); }

    const cx = px * cam.follow;
    camera.position.set(cx, cam.height, cam.distance);
    camera.lookAt(cx, 20, -cam.lookAhead);
    if (cam.fov !== lastFov) { camera.fov = lastFov = cam.fov; camera.updateProjectionMatrix(); }
    renderer.render(scene, camera);
  }

  return {
    name: 'three', cam, defaults: THREE_DEFAULTS, sliders: SLIDERS,
    // what the picker cycles through: every theme, then Auto
    themes: [...THEME_ORDER.map(id => ({ id, label: THEMES[id].label, accent: THEMES[id].edge })), { id: AUTO.id, label: AUTO.label }],
    get theme() { return choice; },                  // the picked id, or 'auto'
    get current() { return { id: targetId, label: THEMES[targetId].label, accent: THEMES[targetId].edge }; },   // what's showing (or fading in)
    set onThemeChange(fn) { onThemeChange = fn; },
    setTheme,
    activate() { canvas.classList.remove('hidden'); },
    deactivate() { canvas.classList.add('hidden'); },
    draw,
  };
}
