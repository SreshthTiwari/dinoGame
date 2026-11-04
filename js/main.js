import { createGame } from './game.js';
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

// Renderer: three.js (real 3D). The 2D canvas on top of it draws the HUD and takes touch input.
const stage = document.getElementById('stage');
let renderer;
try {
  renderer = createThree(canvas, stage);
  renderer.onThemeChange = () => showTheme();
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
