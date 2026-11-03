// Plank mode pose logic: landmarks in, game actions out. No camera, DOM or game imports.
// Assumes the player is already in a plank, facing the camera. Distances are in shoulder
// widths so how far you are from the camera doesn't matter.
//   shoulder tap: the CROSS hand touches the opposite shoulder (right hand -> left shoulder = lane left).
//                 The supporting hand sits under its own shoulder, so it is never counted.
//   pushup:       shoulders lower (calibrated, so camera height / angle doesn't matter) = duck while down.
import { LM } from './gestures.js';

export const PLANK_CONFIG = {
  smooth: 0.6,           // EMA weight of the newest sample
  visibility: 0.5,       // shoulders must be seen at least this well
  handVisibility: 0.3,   // wrists get a lower bar, same as standing mode

  holdSeconds: 1.5,      // calibration: hold the plank still this long
  stillRange: 0.12,      // calibration: max shoulder-height wobble (shoulder widths) while holding
  downHold: 1.0,         // calibration: hold the bottom of a pushup this long
  minDrop: 0.15,         // calibration: a pushup must move the shoulders at least this much (shoulder widths)
  downStill: 0.12,       // calibration: max wobble at the bottom of the pushup

  duckFrac: 0.5,         // duck starts once you're this fraction of the calibrated pushup depth down
  releaseFrac: 0.3,      // ...and ends when you're back above this fraction
  duckHold: 0.05,        // seconds the depth must hold before the duck starts

  tapDist: 0.5,          // cross wrist this close to the opposite shoulder = tap
  tapRelease: 0.8,       // hand must go this far away before the next tap can count
  tapHold: 0.03,         // seconds the hand must stay on the shoulder
  tapCooldown: 0.25,     // seconds between taps
  lostTimeout: 0.5,      // seconds without a person before a duck is released
};

export function extractPlankFeatures(lm, aspect) {
  const [ls, rs, nose, lw, rw] = [lm[LM.L_SHOULDER], lm[LM.R_SHOULDER], lm[LM.NOSE], lm[LM.L_WRIST], lm[LM.R_WRIST]];
  const vis = p => (p.visibility ?? 1);
  const sw = Math.hypot((rs.x - ls.x) * aspect, rs.y - ls.y);
  if (sw < 1e-3 || vis(ls) < PLANK_CONFIG.visibility || vis(rs) < PLANK_CONFIG.visibility) return null;
  const dist = (a, b) => Math.hypot((a.x - b.x) * aspect, a.y - b.y) / sw;
  const seen = p => vis(p) >= PLANK_CONFIG.handVisibility;
  return {
    sw, y: (ls.y + rs.y) / 2,
    // person's right wrist to person's left shoulder, and vice versa (large = "no tap")
    tapLeft: seen(rw) ? dist(rw, ls) : 9,
    tapRight: seen(lw) ? dist(lw, rs) : 9,
    noseSeen: vis(nose) >= PLANK_CONFIG.handVisibility,
  };
}

export function createPlankSmoother(a = PLANK_CONFIG.smooth) {
  let s = null;
  return f => {
    if (!f) { s = null; return null; }
    s = s
      ? {
          sw: s.sw + a * (f.sw - s.sw), y: s.y + a * (f.y - s.y),
          tapLeft: f.tapLeft >= 9 || s.tapLeft >= 9 ? f.tapLeft : s.tapLeft + a * (f.tapLeft - s.tapLeft),
          tapRight: f.tapRight >= 9 || s.tapRight >= 9 ? f.tapRight : s.tapRight + a * (f.tapRight - s.tapRight),
          noseSeen: f.noseSeen,
        }
      : { ...f };
    return s;
  };
}

export const PLANK_CAL_STEPS = 2;

// Step 0: hold the plank still (records the top position). Step 1: lower into a pushup and
// hold the bottom (records which way the shoulders move in the image, and how far).
export function createPlankCalibrator() {
  let step = 0, holdT = 0, samples = [], clock = 0, base = null, result = null;
  let notice = '', noticeT = 0;
  const reset = () => { holdT = 0; samples = []; };
  const fail = (text, toStep) => { notice = text; noticeT = 2.5; reset(); step = toStep; };
  const need = () => step === 0 ? PLANK_CONFIG.holdSeconds : PLANK_CONFIG.downHold;
  const status = message => ({
    step, total: PLANK_CAL_STEPS, done: !!result,
    progress: result ? 1 : Math.min(1, holdT / need()),
    message: noticeT > 0 ? notice : message,
  });
  const prompt = () => step === 0 ? 'Get into your plank, facing the camera' : 'Lower into a pushup and hold the bottom';

  return {
    result: () => result,
    update(f, dt) {
      clock += dt;
      noticeT = Math.max(0, noticeT - dt);
      if (result) return status('Done!');
      if (!f) { reset(); return status('Get into view, shoulders visible'); }

      if (step === 1) {
        const depth = (f.y - base.y) / base.sw;
        if (Math.abs(depth) < PLANK_CONFIG.minDrop) { reset(); return status(prompt()); }
      }
      const sample = { t: clock, y: f.y, sw: f.sw };
      samples.push(sample);
      while (samples[0].t < clock - 0.5) samples.shift();
      holdT += dt;
      const ys = samples.map(s => s.y);
      const range = (step === 0 ? PLANK_CONFIG.stillRange : PLANK_CONFIG.downStill) * (base?.sw ?? f.sw);
      if (Math.max(...ys) - Math.min(...ys) > range) { samples = [sample]; holdT = 0; return status('Hold still'); }
      if (holdT < need()) return status(step === 0 ? 'Hold your plank' : 'Hold the bottom');

      const mean = k => samples.reduce((a, s) => a + s[k], 0) / samples.length;
      if (step === 0) {
        base = { y: mean('y'), sw: mean('sw') };
        reset(); step = 1;
        return status(prompt());
      }
      const depth = (mean('y') - base.y) / base.sw;     // signed: which way "down" is in this camera view
      result = { baseY: base.y, baseSw: base.sw, depth };
      return status('Done!');
    },
  };
}

// Turns plank features into lane steps and a duck flag. Call update() once per camera frame.
export function createPlankController(cal) {
  let armed = { left: true, right: true }, onSince = { left: null, right: null }, lastTap = -Infinity;
  let ducking = false, duckSince = null, lostSince = null;
  const debug = { depth: 0, tapLeft: 9, tapRight: 9 };

  return {
    debug,
    update(f, t) {
      const out = { laneDelta: 0, ducking };
      if (!f) {
        lostSince ??= t;
        if (t - lostSince > PLANK_CONFIG.lostTimeout) { ducking = false; duckSince = null; out.ducking = false; }
        return out;
      }
      lostSince = null;

      // pushup: how far toward the calibrated bottom, 0 = top, 1 = bottom (can overshoot)
      const frac = ((f.y - cal.baseY) / cal.baseSw) / cal.depth;
      debug.depth = frac;
      if (ducking) {
        if (frac < PLANK_CONFIG.releaseFrac) { ducking = false; duckSince = null; }
      } else if (frac > PLANK_CONFIG.duckFrac) {
        duckSince ??= t;
        if (t - duckSince >= PLANK_CONFIG.duckHold) ducking = true;
      } else {
        duckSince = null;
      }

      // shoulder taps: edge-triggered, one lane per tap
      debug.tapLeft = f.tapLeft; debug.tapRight = f.tapRight;
      for (const [side, d, delta] of [['left', f.tapLeft, -1], ['right', f.tapRight, 1]]) {
        if (d > PLANK_CONFIG.tapRelease) { armed[side] = true; onSince[side] = null; continue; }
        if (d > PLANK_CONFIG.tapDist || !armed[side]) { onSince[side] = null; continue; }
        onSince[side] ??= t;
        if (t - onSince[side] >= PLANK_CONFIG.tapHold && t - lastTap >= PLANK_CONFIG.tapCooldown) {
          armed[side] = false; lastTap = t; out.laneDelta = delta;
        }
      }
      out.ducking = ducking;
      return out;
    },
  };
}
