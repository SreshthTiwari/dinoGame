import { createGame, PY } from './game.js';
import { createAudio } from './audio.js';
import { attachKeyboard } from './input/keyboard.js';
import { createPose } from './input/pose.js';
import { CONFIG, extractFeatures, createSmoother, createCalibrator, createController } from './input/gestures.js';
import { extractPlankFeatures, createPlankSmoother, createPlankCalibrator, createPlankController } from './input/plank.js';
import { drawPreview } from './ui/preview.js';
import { createCalibrationUI } from './ui/calibration.js';
import { createCameraPanel } from './ui/camera.js';
import { createThree } from './render/three.js';
import { drawHud } from './render/hud.js';

const canvas = document.getElementById('c');
const video = document.getElementById('cam');
const overlay = document.getElementById('camOverlay');
const ui = createCalibrationUI();

// idle -> loading -> calibrating -> finishing -> ready.  'keyboard' = camera skipped or unavailable.
let mode = 'idle';
let pose = null, calibrator = null, controller = null, cal = null;
const smooth = createSmoother();
const smoothPlank = createPlankSmoother();
let plankMode = true;                // true = plank (shoulder taps + pushups, the default), false = standing (whole body)
let debug = false, wasPlaying = false, lastDetect = 0;

const game = createGame(canvas, { canStart });
game.setPlank(plankMode);
const camPanel = createCameraPanel();
const audio = createAudio();
// browsers only allow sound after a click or key press
for (const type of ['keydown', 'pointerdown']) addEventListener(type, () => audio.unlock(), { once: true });

// Renderer: three.js (real 3D). The 2D canvas on top of it draws the HUD and takes touch input.
const stage = document.getElementById('stage');
let renderer;
try {
  renderer = createThree(canvas, stage);
  renderer.onThemeChange = () => { showTheme(); audio.setTheme(renderer.current.id); };
} catch (err) {                                      // no WebGL: keep the game running (blank scene) and say why
  console.error(err);
  const ctx2d = canvas.getContext('2d');
  renderer = { draw() { ctx2d.fillStyle = '#0e0b1f'; ctx2d.fillRect(0, 0, canvas.width, canvas.height); } };
  setTimeout(() => ui.toast('3D graphics (WebGL) is not available in this browser'), 500);
}
if (renderer.sliders) camPanel.setRenderer(renderer);

// Theme button (also the T key): cycles the colour theme, ending with Auto.
const themeBtn = document.getElementById('themeBtn');
function showTheme() {
  themeBtn.replaceChildren();
  if (!renderer.themes) { themeBtn.classList.add('hidden'); return; }
  const auto = renderer.theme === 'auto', now = renderer.current;      // in auto, show the world that's playing
  const dot = document.createElement('i');
  dot.style.background = now.accent;
  themeBtn.append(dot, `${auto ? 'Auto: ' : ''}${now.label}  (T)`);
}
function cycleTheme() {
  const list = renderer.themes;
  if (!list) return;
  const i = list.findIndex(t => t.id === renderer.theme);
  renderer.setTheme(list[(i + 1) % list.length].id);
  showTheme();
}
themeBtn.addEventListener('click', () => { cycleTheme(); themeBtn.blur(); });
showTheme();

// Sound button (also the M key): sound + music -> sound effects only -> silent
const audioBtn = document.getElementById('audioBtn');
const SOUND_LABELS = { on: 'Sound + music', sfx: 'Sound effects only', off: 'Silent' };
function showSound() { audioBtn.textContent = `${SOUND_LABELS[audio.mode]}  (M)`; }
function cycleSound() { audio.unlock(); audio.cycleMode(); showSound(); }
audioBtn.addEventListener('click', () => { cycleSound(); audioBtn.blur(); });
showSound();

// Game events -> sound and hit effects
const fx = renderer.fx;
const ride = (...a) => fx?.burst(...a);
game.on('start', () => { audio.play('start'); audio.setLevel(1); audio.setTempoScale(1); audio.setPlaying(true); });
game.on('laneChange', d => { audio.play('laneChange', d); ride(d.x, PY, 2, '#cfc8ff', { n: 7, speed: 70, up: 50, life: 0.35 }); });
game.on('jump', () => { audio.play('jump'); ride(game.getView().player.x, PY, 2, '#cfc8ff', { n: 8, speed: 80, up: 60, life: 0.4 }); });
game.on('duck', () => audio.play('duck'));
game.on('pickup', d => {
  const color = d.type === 'ghost' ? '#c9b6ff' : '#4de8ff';
  audio.play('pickup', d);
  ride(d.x, PY, 40, color, { n: 38, speed: 150, up: 150, life: 0.8 });
  fx?.flash(color, 0.16, 0.3);
});
game.on('shieldBreak', d => {
  audio.play('shieldBreak');
  ride(d.x, d.y, 30, '#4de8ff', { n: 44, speed: 230, up: 170, life: 0.8 });
  ride(d.x, d.y, 30, '#ffffff', { n: 16, speed: 160, up: 120, life: 0.5 });
  fx?.flash('#4de8ff', 0.35, 0.35); fx?.shake(7, 0.3);
});
game.on('ghostEnd', () => audio.play('ghostEnd'));
game.on('breatherStart', () => { audio.play('breatherStart'); audio.setTempoScale(0.6); });
game.on('breatherEnd', () => { audio.play('breatherEnd'); audio.setTempoScale(1); });
game.on('level', d => { audio.play('level'); audio.setLevel(d.level); });
game.on('die', d => {
  audio.play('die'); audio.setPlaying(false);
  ride(d.x, PY, 30, '#ff5d8f', { n: 60, speed: 300, up: 230, life: 0.95 });
  ride(d.x, PY, 30, '#ffffff', { n: 24, speed: 220, up: 180, life: 0.6 });
  fx?.flash('#ff3355', 0.5, 0.5); fx?.shake(16, 0.55);
});
attachKeyboard(canvas, game);

// The first start request kicks off camera setup; the game only starts once calibration is done.
function canStart() {
  if (mode === 'ready' || mode === 'keyboard') return true;
  if (mode === 'idle') loadCamera();
  return false;
}

async function loadCamera() {
  mode = 'loading';
  ui.open('Starting camera...');
  try {
    pose ??= await createPose(video);
  } catch (err) {
    console.error(err);
    if (mode === 'loading') useKeyboard('Camera unavailable - using keyboard');
    return;
  }
  if (mode !== 'loading') return;      // skipped while the camera was starting
  ui.setAspect(pose.aspect);
  startCalibration();
}

function startCalibration() {
  mode = 'calibrating';
  calibrator = plankMode ? createPlankCalibrator() : createCalibrator();
  controller = null;
  ui.setMessage(plankMode ? '(1/2) Get into your plank, facing the camera' : '(1/5) Step into the LEFT lane');
  ui.setProgress(0);
  ui.showBig();
}

function finishCalibration() {
  mode = 'finishing';
  cal = calibrator.result();
  ui.setMessage('Ready!');
  setTimeout(() => {
    if (mode !== 'finishing') return;
    controller = plankMode ? createPlankController(cal) : createController(cal);
    mode = 'ready';
    ui.showMini();
    game.start();
  }, 800);
}

function useKeyboard(message) {
  mode = 'keyboard';
  controller = null;
  ui.close();
  ui.hideCam();
  game.setDuckHeld(false, 'pose');
  game.setJumpHeld(false, 'pose');
  if (message) ui.toast(message);
}

addEventListener('keydown', e => {
  if (e.repeat) return;
  if (e.code === 'Escape' && mode !== 'keyboard' && mode !== 'idle') useKeyboard('Keyboard only - press C for camera');
  if (e.code === 'KeyC' && !game.isPlaying() && mode !== 'loading' && mode !== 'calibrating' && mode !== 'finishing') {
    if (pose) startCalibration(); else loadCamera();
  }
  if (e.code === 'KeyP' && !game.isPlaying() && mode !== 'loading' && mode !== 'calibrating' && mode !== 'finishing') {
    plankMode = !plankMode;
    game.setPlank(plankMode);
    ui.toast(plankMode ? 'Plank mode' : 'Standing mode');
    if (pose && mode !== 'keyboard') startCalibration();   // each mode has its own calibration
  }
  if (e.code === 'KeyV') ui.toggleMini();
  if (e.code === 'KeyH') camPanel.toggle();
  if (e.code === 'KeyT') cycleTheme();
  if (e.code === 'KeyM') cycleSound();
  if (e.code === 'KeyD') debug = !debug;
});

// Reads the newest camera frame (if any) and routes it to calibration or play.
function pollPose(t) {
  const landmarks = pose.detect();
  if (landmarks === undefined) return;   // no new camera frame yet
  const dt = Math.min(0.2, t - lastDetect); lastDetect = t;
  const f = plankMode
    ? smoothPlank(landmarks && extractPlankFeatures(landmarks, pose.aspect))
    : smooth(landmarks && extractFeatures(landmarks, pose.aspect));

  if (mode === 'calibrating' && plankMode) {
    const s = calibrator.update(f, dt);
    ui.setMessage(s.done ? s.message : `(${s.step + 1}/${s.total}) ${s.message}`);
    ui.setProgress(s.progress);
    drawPreview(overlay, video, landmarks, { bands: false });
    if (s.done) finishCalibration();
  } else if (mode === 'ready' && plankMode) {
    const act = controller.update(f, t);
    const playing = game.isPlaying();
    if (playing && act.laneDelta) game.move(act.laneDelta);
    game.setDuckHeld(playing && act.ducking, 'pose');
    const d = controller.debug;
    drawPreview(overlay, video, landmarks, {
      bands: false,
      debug: debug ? `pushup ${d.depth.toFixed(2)} tapL ${d.tapLeft.toFixed(2)} tapR ${d.tapRight.toFixed(2)}` : '',
    });
  } else if (mode === 'calibrating') {
    const s = calibrator.update(f, dt);
    ui.setMessage(s.done ? s.message : `(${s.step + 1}/${s.total}) ${s.message}`);
    ui.setProgress(s.progress);
    const lanes = s.step < 3;     // steps 3-4 are the hand gestures, where the lane bands would just be noise
    drawPreview(overlay, video, landmarks, { bands: lanes, labels: lanes, active: s.step, bounds: CONFIG.calEdges });
    if (s.done) finishCalibration();
  } else if (mode === 'ready') {
    const act = controller.update(f, t);
    const playing = game.isPlaying();
    if (playing) {
      if (act.laneChanged) game.setLane(act.lane);
      if (act.jump) game.jump();
    }
    game.setJumpHeld(playing && act.jumpHeld, 'pose');
    game.setDuckHeld(playing && act.ducking, 'pose');
    const d = controller.debug;
    drawPreview(overlay, video, landmarks, {
      bounds: cal.bounds, active: act.lane,
      debug: debug ? `lanes ${d.shares.map(s => Math.round(s * 100)).join('/')}% rise ${d.rise.toFixed(2)} drop ${d.drop.toFixed(2)} up ${d.up.toFixed(2)}/${cal.handsUpMin.toFixed(2)} head ${d.dist.toFixed(2)}/${cal.onHeadMax.toFixed(2)}` : '',
    });
  }
}

let last = performance.now();
function loop(now) {
  const dt = Math.min(0.033, (now - last) / 1000); last = now;
  if (pose && (mode === 'calibrating' || mode === 'ready')) pollPose(now / 1000);

  const playing = game.isPlaying();
  if (playing && !wasPlaying && controller) {   // a run just began: line up with where the player is standing
    if (!plankMode) { game.setLane(controller.lane); controller.resetJump(); }
  }
  if (!playing) { game.setDuckHeld(false, 'pose'); game.setJumpHeld(false, 'pose'); }
  wasPlaying = playing;

  game.update(dt);
  renderer.draw(game.getView());
  drawHud(canvas.getContext('2d'), game.getView());
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);
