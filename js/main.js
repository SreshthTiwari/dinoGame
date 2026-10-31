import { createGame } from './game.js';
import { attachKeyboard } from './input/keyboard.js';
import { createPose } from './input/pose.js';
import { CONFIG, extractFeatures, createSmoother, createCalibrator, createController } from './input/gestures.js';
import { drawPreview } from './ui/preview.js';
import { createCalibrationUI } from './ui/calibration.js';

const canvas = document.getElementById('c');
const video = document.getElementById('cam');
const overlay = document.getElementById('camOverlay');
const ui = createCalibrationUI();

// idle -> loading -> calibrating -> finishing -> ready.  'keyboard' = camera skipped or unavailable.
let mode = 'idle';
let pose = null, calibrator = null, controller = null, cal = null;
const smooth = createSmoother();
let debug = false, wasPlaying = false, lastDetect = 0;

const game = createGame(canvas, { canStart });
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
  calibrator = createCalibrator();
  controller = null;
  ui.setMessage('(1/5) Step into the LEFT lane');
  ui.setProgress(0);
  ui.showBig();
}

function finishCalibration() {
  mode = 'finishing';
  cal = calibrator.result();
  ui.setMessage('Ready!');
  setTimeout(() => {
    if (mode !== 'finishing') return;
    controller = createController(cal);
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
  if (message) ui.toast(message);
}

addEventListener('keydown', e => {
  if (e.repeat) return;
  if (e.code === 'Escape' && mode !== 'keyboard' && mode !== 'idle') useKeyboard('Keyboard only - press C for camera');
  if (e.code === 'KeyC' && !game.isPlaying() && mode !== 'loading' && mode !== 'calibrating' && mode !== 'finishing') {
    if (pose) startCalibration(); else loadCamera();
  }
  if (e.code === 'KeyV') ui.toggleMini();
  if (e.code === 'KeyD') debug = !debug;
});

// Reads the newest camera frame (if any) and routes it to calibration or play.
function pollPose(t) {
  const landmarks = pose.detect();
  if (landmarks === undefined) return;   // no new camera frame yet
  const dt = Math.min(0.2, t - lastDetect); lastDetect = t;
  const f = smooth(landmarks && extractFeatures(landmarks, pose.aspect));

  if (mode === 'calibrating') {
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
    game.setDuckHeld(playing && act.ducking, 'pose');
    const d = controller.debug;
    drawPreview(overlay, video, landmarks, {
      bounds: cal.bounds, active: act.lane,
      debug: debug ? `rise ${d.rise.toFixed(2)} drop ${d.drop.toFixed(2)} up ${d.up.toFixed(2)}/${cal.handsUpMin.toFixed(2)} head ${d.dist.toFixed(2)}/${cal.onHeadMax.toFixed(2)}` : '',
    });
  }
}

let last = performance.now();
function loop(now) {
  const dt = Math.min(0.033, (now - last) / 1000); last = now;
  if (pose && (mode === 'calibrating' || mode === 'ready')) pollPose(now / 1000);

  const playing = game.isPlaying();
  if (playing && !wasPlaying && controller) {   // a run just began: line up with where the player is standing
    game.setLane(controller.lane);
    controller.resetJump();
  }
  if (!playing) game.setDuckHeld(false, 'pose');
  wasPlaying = playing;

  game.update(dt);
  game.draw();
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);
