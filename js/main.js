import { createGame } from './game.js';
import { attachKeyboard } from './input/keyboard.js';
import { createPose } from './input/pose.js';
import { CONFIG, extractFeatures, createSmoother, createCalibrator, createController } from './input/gestures.js';
import { extractPlankFeatures, createPlankSmoother, createPlankCalibrator, createPlankController } from './input/plank.js';
import { drawPreview } from './ui/preview.js';
import { createCalibrationUI } from './ui/calibration.js';
import { createCameraPanel } from './ui/camera.js';
import { createFake3D } from './render/fake3d.js';
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

// Renderers: 'fake3d' (2D canvas with hand-made perspective) and 'three' (real 3D, loaded on demand).
// Real 3D is the default. R switches; a choice you make is remembered, and ?render=three or
// ?render=fake3d overrides it. (Only an explicit switch is saved, never the default.)
const stage = document.getElementById('stage');
const renderers = { fake3d: createFake3D(canvas) };
let renderer = renderers.fake3d;
async function setRenderer(name, remember = false) {
  if (!renderers[name]) {
    try {
      const { createThree } = await import('./render/three.js');
      renderers[name] = createThree(canvas, stage);
      renderers[name].onThemeChange = () => { if (renderer === renderers[name]) showTheme(); };
    } catch (err) {
      console.error(err);
      ui.toast('Could not start the three.js renderer (see console)');
      return;
    }
  }
  renderer.deactivate();
  renderer = renderers[name];
  renderer.activate();
  camPanel.setRenderer(renderer);
  showTheme();
  if (remember) try { localStorage.setItem('blip-renderer-choice', name); } catch {}
}
// Theme button (also the T key): cycles the colour theme. Themes only exist in the three.js look,
// so on the fake-3D look the button says so and switches to three.js when pressed.
const themeBtn = document.getElementById('themeBtn');
function showTheme() {
  const list = renderer.themes;
  themeBtn.replaceChildren();
  const dot = document.createElement('i');
  if (!list) {
    dot.style.background = '#8c82c8';
    themeBtn.append(dot, 'Fake 3D - click for real 3D + themes (T)');
    return;
  }
  const auto = renderer.theme === 'auto', now = renderer.current;      // in auto, show the world that's playing
  dot.style.background = now.accent;
  themeBtn.append(dot, `${auto ? 'Auto: ' : ''}${now.label}  (T)`);
}
async function cycleTheme() {
  if (!renderer.themes) {
    await setRenderer('three', true);
    if (!renderer.themes) return;                    // three.js failed to start (toast already shown)
    return ui.toast('Real 3D - press T to change theme');
  }
  const list = renderer.themes;
  const i = list.findIndex(t => t.id === renderer.theme);
  renderer.setTheme(list[(i + 1) % list.length].id);
  showTheme();
}
themeBtn.addEventListener('click', () => { cycleTheme(); themeBtn.blur(); });
{
  let want = new URLSearchParams(location.search).get('render');
  try { want ??= localStorage.getItem('blip-renderer-choice'); } catch {}
  showTheme();
  setRenderer(want === 'fake3d' ? 'fake3d' : 'three');
}
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
  if (e.code === 'KeyR') {
    const next = renderer.name === 'fake3d' ? 'three' : 'fake3d';
    setRenderer(next, true).then(() => ui.toast(next === 'three' ? 'three.js 3D' : 'Fake 3D'));
  }
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
