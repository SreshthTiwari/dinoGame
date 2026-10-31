// Pure pose logic: landmarks in, game actions out. No camera, DOM or game imports.
// x is in frame widths (mirrored so it matches what the player sees), y in frame
// heights, and vertical motion is measured in torso lengths so distance to the
// camera doesn't matter.

export const LM = { NOSE: 0, L_SHOULDER: 11, R_SHOULDER: 12, L_HIP: 23, R_HIP: 24, L_ANKLE: 27, R_ANKLE: 28 };

// Starting guesses, to be tuned by playing.
export const CONFIG = {
  smooth: 0.6,            // EMA weight of the newest sample (higher = snappier, noisier)
  visibility: 0.5,        // min landmark visibility to count as "seen"

  holdSeconds: 1.5,       // calibration: how long to stand still in each lane
  stillRange: 0.025,      // calibration: max sideways drift (frame widths) inside the window below
  stillWindow: 0.5,       // calibration: seconds of recent movement the stillness check looks at
  minLaneGap: 0.08,       // calibration: lane centers must be at least this far apart
  calEdges: [0.4, 0.6],   // calibration zones: left < 0.4 <= center < 0.6 <= right (smaller = less movement)

  laneHysteresis: 0.15,   // overshoot a lane boundary by this fraction of the lane gap to switch

  jumpWindow: 0.2,        // seconds of history used to measure takeoff
  jumpRise: 0.18,         // torso lengths risen inside the window = takeoff
  jumpCooldown: 0.7,      // seconds before another jump can fire
  postDuckLock: 0.4,      // no jump this soon after standing up from a duck

  duckDrop: 0.3,          // torso lengths below standing height to start a duck
  duckRelease: 0.18,      // ...and back above this to end it
  duckHold: 0.08,         // seconds the drop must hold before it counts
  lostTimeout: 0.5,       // seconds without a person before a duck is released
};

export function extractFeatures(lm, aspect) {
  const [lh, rh, ls, rs] = [lm[LM.L_HIP], lm[LM.R_HIP], lm[LM.L_SHOULDER], lm[LM.R_SHOULDER]];
  const hipX = (lh.x + rh.x) / 2, hipY = (lh.y + rh.y) / 2;
  const shX = (ls.x + rs.x) / 2, shY = (ls.y + rs.y) / 2;
  const torso = Math.hypot((shX - hipX) * aspect, shY - hipY);
  if (torso < 1e-3) return null;

  const needed = [LM.NOSE, LM.L_SHOULDER, LM.R_SHOULDER, LM.L_HIP, LM.R_HIP, LM.L_ANKLE, LM.R_ANKLE];
  const fullBody = needed.every(i => {
    const p = lm[i];
    return (p.visibility ?? 1) >= CONFIG.visibility && p.x > -0.02 && p.x < 1.02 && p.y > -0.02 && p.y < 1.02;
  });
  return { x: 1 - hipX, coreY: (hipY + shY) / 2, torso, fullBody };
}

export function createSmoother(a = CONFIG.smooth) {
  let s = null;
  return f => {
    if (!f) { s = null; return null; }
    s = s
      ? { x: s.x + a * (f.x - s.x), coreY: s.coreY + a * (f.coreY - s.coreY), torso: s.torso + a * (f.torso - s.torso), fullBody: f.fullBody }
      : { ...f };
    return s;
  };
}

export const LANE_NAMES = ['LEFT', 'CENTER', 'RIGHT'];

// Walks the player through standing in each lane. Feed it one feature set per camera
// frame; it records where each lane is and the standing baseline (from the center lane).
export function createCalibrator() {
  let step = 0, holdT = 0, samples = [], centers = [], base = null, result = null;
  let clock = 0;
  let notice = '', noticeT = 0;          // a failure message that stays up for a moment
  const reset = () => { holdT = 0; samples = []; };
  const status = message => ({
    step, name: LANE_NAMES[step],
    progress: result ? 1 : Math.min(1, holdT / CONFIG.holdSeconds),
    message: noticeT > 0 ? notice : message, done: !!result,
  });
  const prompt = () => `Step into the ${LANE_NAMES[step]} lane`;

  return {
    result: () => result,
    update(f, dt) {
      clock += dt;
      noticeT = Math.max(0, noticeT - dt);
      if (result) return status('Done!');
      if (!f) { reset(); return status('Step into view'); }
      if (!f.fullBody) { reset(); return status('Step back so your whole body is visible'); }

      const band = f.x < CONFIG.calEdges[0] ? 0 : f.x < CONFIG.calEdges[1] ? 1 : 2;
      if (band !== step) { reset(); return status(prompt()); }

      // stillness is judged over the last stillWindow seconds only, so settling into the
      // spot or a slow sway earlier in the hold doesn't throw the whole hold away
      const sample = { t: clock, x: f.x, coreY: f.coreY, torso: f.torso };
      samples.push(sample);
      while (samples[0].t < clock - CONFIG.stillWindow) samples.shift();
      holdT += dt;
      const xs = samples.map(s => s.x);
      if (Math.max(...xs) - Math.min(...xs) > CONFIG.stillRange) { samples = [sample]; holdT = 0; return status('Hold still'); }
      if (holdT < CONFIG.holdSeconds) return status('Hold still');

      const mean = k => samples.reduce((a, s) => a + s[k], 0) / samples.length;
      centers.push(mean('x'));
      if (step === 1) base = { coreY: mean('coreY'), torso: mean('torso') };
      reset();
      step++;
      if (step < 3) return status(prompt());

      const gap = Math.min(centers[1] - centers[0], centers[2] - centers[1]);
      if (gap < CONFIG.minLaneGap) {
        centers = []; step = 0;
        notice = 'Lanes too close - spread out a bit more'; noticeT = 2;
        return status(prompt());
      }
      result = {
        centers,
        bounds: [(centers[0] + centers[1]) / 2, (centers[1] + centers[2]) / 2],
        gap,
        baseCoreY: base.coreY,
        baseTorso: base.torso,
      };
      return status('Done!');
    },
  };
}

// Turns calibrated features into lane / jump / duck. Call update() once per camera frame.
// jump fires on takeoff (the body starting to rise), not at the peak.
export function createController(cal) {
  const [b0, b1] = cal.bounds;
  const margin = CONFIG.laneHysteresis * cal.gap;
  let lane = 1, hist = [], cooldownUntil = 0;
  let ducking = false, duckSince = null, lastDuckEnd = -Infinity, lostSince = null;
  const debug = { rise: 0, drop: 0 };

  return {
    get lane() { return lane; },
    debug,
    resetJump() { hist = []; cooldownUntil = 0; },
    update(f, t) {
      const out = { lane, laneChanged: false, jump: false, ducking };
      if (!f) {
        lostSince ??= t;
        if (t - lostSince > CONFIG.lostTimeout) { ducking = false; duckSince = null; out.ducking = false; }
        return out;
      }
      lostSince = null;

      // lane, with hysteresis so standing near a boundary doesn't flicker
      let next = lane;
      if (lane === 0 && f.x > b0 + margin) next = f.x > b1 + margin ? 2 : 1;
      else if (lane === 1) { if (f.x < b0 - margin) next = 0; else if (f.x > b1 + margin) next = 2; }
      else if (lane === 2 && f.x < b1 - margin) next = f.x < b0 - margin ? 0 : 1;
      if (next !== lane) { lane = next; out.laneChanged = true; }

      // duck: squat below the calibrated standing height, held briefly
      const drop = (f.coreY - cal.baseCoreY) / cal.baseTorso;
      debug.drop = drop;
      if (ducking) {
        if (drop < CONFIG.duckRelease) { ducking = false; duckSince = null; lastDuckEnd = t; }
      } else if (drop > CONFIG.duckDrop) {
        duckSince ??= t;
        if (t - duckSince >= CONFIG.duckHold) ducking = true;
      } else {
        duckSince = null;
      }

      // jump: how far the body rose over the last few frames
      hist.push({ t, y: f.coreY });
      while (hist.length && t - hist[0].t > CONFIG.jumpWindow) hist.shift();
      const rise = (hist[0].y - f.coreY) / f.torso;
      debug.rise = rise;
      const free = !ducking && duckSince === null && t >= cooldownUntil && t - lastDuckEnd > CONFIG.postDuckLock;
      if (free && rise > CONFIG.jumpRise) {
        out.jump = true;
        cooldownUntil = t + CONFIG.jumpCooldown;
        hist = [];
      }

      out.lane = lane;
      out.ducking = ducking;
      return out;
    },
  };
}
