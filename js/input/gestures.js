// Pure pose logic: landmarks in, game actions out. No camera, DOM or game imports.
// x is in frame widths (mirrored so it matches what the player sees), y in frame
// heights, and vertical motion / hand positions are measured in torso lengths so
// distance to the camera doesn't matter.

export const LM = {
  NOSE: 0, L_EAR: 7, R_EAR: 8, L_SHOULDER: 11, R_SHOULDER: 12, L_WRIST: 15, R_WRIST: 16,
  L_HIP: 23, R_HIP: 24, L_KNEE: 25, R_KNEE: 26, L_ANKLE: 27, R_ANKLE: 28,
};
// points that make up the body's width for lane purposes (arms left out so waving doesn't widen it)
const BODY_POINTS = [LM.L_SHOULDER, LM.R_SHOULDER, LM.L_HIP, LM.R_HIP, LM.L_KNEE, LM.R_KNEE, LM.L_ANKLE, LM.R_ANKLE];

// Starting guesses, to be tuned by playing.
export const CONFIG = {
  smooth: 0.6,            // EMA weight of the newest sample (higher = snappier, noisier)
  visibility: 0.5,        // min landmark visibility to count as "seen"
  handVisibility: 0.3,    // wrists are often half hidden by the head, so they get a lower bar

  holdSeconds: 1.5,       // calibration: how long to stand still in each lane
  stillRange: 0.025,      // calibration: max sideways drift (frame widths) inside the window below
  stillWindow: 0.5,       // calibration: seconds of recent movement the stillness check looks at
  minLaneGap: 0.08,       // calibration: lane centers must be at least this far apart
  calEdges: [0.35, 0.65], // calibration zones: left < first edge <= center < second edge <= right (closer to 0.5 = less movement)

  laneShare: 0.6,         // switch lanes once this fraction of your body's width is inside another lane (lower = less movement)
  laneHold: 0.03,         // seconds that has to hold before the switch (about one frame, so one noisy frame can't switch)
  laneLead: 0.08,         // seconds to look ahead along your sideways motion, to cancel camera + processing lag (0 = off)
  laneLeadMin: 0.3,       // ...but only once at least this fraction of your body is already inside the new lane
  laneSmooth: 0.85,       // smoothing weight for sideways position (higher = less lag, more jitter)

  jumpWindow: 0.2,        // seconds of history used to measure takeoff
  jumpRise: 0.18,         // torso lengths risen inside the window = takeoff
  jumpCooldown: 0.7,      // seconds before another jump can fire
  postDuckLock: 0.4,      // no jump this soon after standing up from a duck

  duckDrop: 0.3,          // torso lengths below standing height to start a duck
  duckRelease: 0.18,      // ...and back above this to end it
  duckHold: 0.08,         // seconds the drop must hold before it counts
  lostTimeout: 0.5,       // seconds without a person before a duck is released

  // hand gestures: hands above head = jump, hands on head = duck
  gestureHold: 1.0,       // calibration: seconds to hold each hand pose
  gestureStill: 0.12,     // calibration: max movement (torso lengths) of the hand pose while holding
  raisePre: 0.35,         // calibration: hands must be at least this far above the head to start counting
  headPre: 0.8,           // calibration: hands must be at least this close to the head to start counting
  minRaise: 0.5,          // calibration: a raise lower than this (torso lengths above the head) is rejected
  maxOnHead: 0.7,         // calibration: "on head" farther than this from the head is rejected
  handsUpScale: 0.7,      // play: hands-up threshold = this fraction of your calibrated raise height
  onHeadScale: 1.6,       // play: on-head limit = calibrated head distance * this + onHeadPad
  onHeadPad: 0.1,
  handHysteresis: 0.15,   // once a hand gesture is on, its threshold relaxes by this fraction until it ends
  handsUpHold: 0.05,      // seconds hands must stay up before jumping starts
  onHeadHold: 0.2,        // seconds hands must stay on the head before the duck starts (so raising your
                          // hands past your head doesn't flicker a duck)
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

  // hands, relative to the middle of the head: how far above it (handsUp, worst hand)
  // and how far from it (handsDist, worst hand), both in torso lengths
  const [nose, le, re, lw, rw] = [lm[LM.NOSE], lm[LM.L_EAR], lm[LM.R_EAR], lm[LM.L_WRIST], lm[LM.R_WRIST]];
  const headX = (nose.x + le.x + re.x) / 3, headY = (nose.y + le.y + re.y) / 3;
  const handsSeen = [lw, rw].every(p => (p.visibility ?? 1) >= CONFIG.handVisibility);
  const up = p => (headY - p.y) / torso;
  const dist = p => Math.hypot((p.x - headX) * aspect, p.y - headY) / torso;

  // horizontal extent of the body (mirrored); falls back to a point at the hips if too little is visible
  const xs = BODY_POINTS.map(i => lm[i]).filter(p => (p.visibility ?? 1) >= CONFIG.handVisibility).map(p => 1 - p.x);
  const wide = xs.length >= 2;

  return {
    x: 1 - hipX, coreY: (hipY + shY) / 2, torso, fullBody,
    left: wide ? Math.min(...xs) : 1 - hipX, right: wide ? Math.max(...xs) : 1 - hipX,
    handsSeen,
    handsUp: handsSeen ? Math.min(up(lw), up(rw)) : -1,   // -1 / 3 = "clearly neither gesture"
    handsDist: handsSeen ? Math.max(dist(lw), dist(rw)) : 3,
  };
}

// a smooths everything; aLane is the (lighter) smoothing for sideways position, where lag is most noticeable
export function createSmoother(a = CONFIG.smooth, aLane = CONFIG.laneSmooth) {
  let s = null;
  const blend = (prev, cur) => prev + a * (cur - prev);
  const blendLane = (prev, cur) => prev + aLane * (cur - prev);
  return f => {
    if (!f) { s = null; return null; }
    const both = s && s.handsSeen && f.handsSeen;   // only blend hand values while both frames saw the hands
    s = s
      ? {
          x: blendLane(s.x, f.x), coreY: blend(s.coreY, f.coreY), torso: blend(s.torso, f.torso), fullBody: f.fullBody,
          left: blendLane(s.left, f.left), right: blendLane(s.right, f.right),
          handsSeen: f.handsSeen,
          handsUp: both ? blend(s.handsUp, f.handsUp) : f.handsUp,
          handsDist: both ? blend(s.handsDist, f.handsDist) : f.handsDist,
        }
      : { ...f };
    return s;
  };
}

export const LANE_NAMES = ['LEFT', 'CENTER', 'RIGHT'];
export const CAL_STEPS = 5;                 // three lanes, then hands above head, then hands on head

// Walks the player through the calibration steps. Feed it one feature set per camera
// frame. Steps 0-2 record where each lane is (and the standing baseline, from the center
// lane); step 3 records how high they raise their hands, step 4 how close to the head.
export function createCalibrator() {
  let step = 0, holdT = 0, samples = [], centers = [], base = null, result = null;
  let raised = null, clock = 0;
  let notice = '', noticeT = 0;          // a failure message that stays up for a moment
  const reset = () => { holdT = 0; samples = []; };
  const fail = (text, toStep) => { notice = text; noticeT = 2.5; reset(); step = toStep; };
  const status = message => ({
    step, total: CAL_STEPS,
    progress: result ? 1 : Math.min(1, holdT / (step < 3 ? CONFIG.holdSeconds : CONFIG.gestureHold)),
    message: noticeT > 0 ? notice : message, done: !!result,
  });
  const prompt = () => step < 3 ? `Step into the ${LANE_NAMES[step]} lane`
    : step === 3 ? 'Raise both hands above your head'
    : 'Now put both hands on your head';

  return {
    result: () => result,
    update(f, dt) {
      clock += dt;
      noticeT = Math.max(0, noticeT - dt);
      if (result) return status('Done!');
      if (!f) { reset(); return status('Step into view'); }

      // what this step watches (metric), and whether the player is in position for it yet
      const lane = step < 3;
      let metric;
      if (lane) {
        if (!f.fullBody) { reset(); return status('Step back so your whole body is visible'); }
        const band = f.x < CONFIG.calEdges[0] ? 0 : f.x < CONFIG.calEdges[1] ? 1 : 2;
        if (band !== step) { reset(); return status(prompt()); }
        metric = f.x;
      } else if (step === 3) {
        if (!f.handsSeen || f.handsUp < CONFIG.raisePre) { reset(); return status(prompt()); }
        metric = f.handsUp;
      } else {
        if (!f.handsSeen || f.handsDist > CONFIG.headPre) { reset(); return status(prompt()); }
        metric = f.handsDist;
      }

      // stillness is judged over the last stillWindow seconds only, so settling into the
      // spot or a slow sway earlier in the hold doesn't throw the whole hold away
      const sample = { t: clock, m: metric, x: f.x, coreY: f.coreY, torso: f.torso };
      samples.push(sample);
      while (samples[0].t < clock - CONFIG.stillWindow) samples.shift();
      holdT += dt;
      const ms = samples.map(s => s.m);
      const range = lane ? CONFIG.stillRange : CONFIG.gestureStill;
      if (Math.max(...ms) - Math.min(...ms) > range) { samples = [sample]; holdT = 0; return status('Hold still'); }
      if (holdT < (lane ? CONFIG.holdSeconds : CONFIG.gestureHold)) return status('Hold still');

      const mean = k => samples.reduce((a, s) => a + s[k], 0) / samples.length;

      if (lane) {
        centers.push(mean('x'));
        if (step === 1) base = { coreY: mean('coreY'), torso: mean('torso') };
        reset();
        step++;
        if (step < 3) return status(prompt());
        const gap = Math.min(centers[1] - centers[0], centers[2] - centers[1]);
        if (gap < CONFIG.minLaneGap) {
          centers = [];
          fail('Lanes too close - spread out a bit more', 0);
        }
        return status(prompt());
      }

      if (step === 3) {
        raised = mean('m');
        if (raised < CONFIG.minRaise) { fail('Raise your hands higher above your head', 3); return status(prompt()); }
        reset();
        step = 4;
        return status(prompt());
      }

      const onDist = mean('m');
      const handsUpMin = Math.max(CONFIG.raisePre, CONFIG.handsUpScale * raised);
      if (onDist > CONFIG.maxOnHead) { fail('Hands closer to your head', 4); return status(prompt()); }
      if (onDist * (1 + CONFIG.handHysteresis) > handsUpMin - 0.05) {
        fail('Raise your hands higher, then put them right on your head', 3);
        return status(prompt());
      }
      result = {
        centers,
        bounds: [(centers[0] + centers[1]) / 2, (centers[1] + centers[2]) / 2],
        gap: Math.min(centers[1] - centers[0], centers[2] - centers[1]),
        baseCoreY: base.coreY,
        baseTorso: base.torso,
        handsUpMin,
        onHeadMax: Math.min(handsUpMin - 0.05, CONFIG.onHeadScale * onDist + CONFIG.onHeadPad),
      };
      return status('Done!');
    },
  };
}

// Turns calibrated features into lane / jump / duck. Call update() once per camera frame.
// Body jump fires on takeoff (the body starting to rise), not at the peak. Hands above the
// head keep jumping while they stay up (out.jumpHeld), and hands on the head keep ducking
// while they stay there, on top of the squat duck.
export function createController(cal) {
  const edges = [-Infinity, cal.bounds[0], cal.bounds[1], Infinity];   // lane i spans edges[i]..edges[i+1]
  let lane = 1, laneCand = null, laneSince = 0, xHist = [], hist = [], cooldownUntil = 0;
  let ducking = false, duckSince = null, lastDuckEnd = -Infinity, lostSince = null;
  let upOn = false, upSince = null, jumpHeld = false;
  let headOn = false, headSince = null, headDuck = false;
  const debug = { rise: 0, drop: 0, up: 0, dist: 0, shares: [0, 0, 0] };

  return {
    get lane() { return lane; },
    debug,
    resetJump() { hist = []; cooldownUntil = 0; },
    update(f, t) {
      const out = { lane, laneChanged: false, jump: false, jumpHeld, ducking: ducking || headDuck };
      if (!f) {
        lostSince ??= t;
        if (t - lostSince > CONFIG.lostTimeout) {
          ducking = false; duckSince = null;
          upOn = false; upSince = null; jumpHeld = false;
          headOn = false; headSince = null; headDuck = false;
          out.ducking = false; out.jumpHeld = false;
        }
        return out;
      }
      lostSince = null;

      // lane: what fraction of the body's width is inside each lane. Move once a major portion
      // (laneShare) is in another lane, and that holds for a moment. The check looks a little
      // ahead along the body's sideways motion (laneLead) to cancel camera + processing lag.
      const width = f.right - f.left;
      const shareOf = (shift) => [0, 1, 2].map(i => width < 0.02
        ? (f.x + shift >= edges[i] && f.x + shift < edges[i + 1] ? 1 : 0)
        : Math.max(0, Math.min(f.right + shift, edges[i + 1]) - Math.max(f.left + shift, edges[i])) / width);
      const mid = (f.left + f.right) / 2;
      xHist.push({ t, mid });
      while (xHist.length > 1 && t - xHist[0].t > 0.15) xHist.shift();
      // sideways speed (frame widths/s). It must show in both the last frame and the last ~0.15 s,
      // so the look-ahead switches itself off the moment the body stops.
      const span = t - xHist[0].t, prev = xHist.length > 1 ? xHist[xHist.length - 2] : null;
      const vWin = span >= 0.05 ? (mid - xHist[0].mid) / span : 0;
      const vNow = prev && t - prev.t > 0.01 ? (mid - prev.mid) / (t - prev.t) : 0;
      const vx = Math.sign(vWin) === Math.sign(vNow) ? Math.sign(vWin) * Math.min(1.5, Math.abs(vWin), Math.abs(vNow)) : 0;
      const shares = shareOf(0);
      const ahead = shareOf(vx * CONFIG.laneLead);
      debug.shares = shares;
      const target = ahead.findIndex((s, i) => s >= CONFIG.laneShare && shares[i] >= (i === lane ? 0 : CONFIG.laneLeadMin));
      if (target >= 0 && target !== lane) {
        if (laneCand !== target) { laneCand = target; laneSince = t; }
        else if (t - laneSince >= CONFIG.laneHold) { lane = target; laneCand = null; out.laneChanged = true; }
      } else {
        laneCand = null;
      }

      // hands: "up" and "on head" are exclusive, and each relaxes slightly once it's on
      const h = CONFIG.handHysteresis;
      debug.up = f.handsUp; debug.dist = f.handsDist;
      upOn = f.handsSeen && f.handsUp >= cal.handsUpMin * (upOn ? 1 - h : 1);
      headOn = !upOn && f.handsSeen && f.handsDist <= cal.onHeadMax * (headOn ? 1 + h : 1);

      // hands above head: jump for as long as they stay up (the game jumps again on every landing)
      if (upOn) {
        upSince ??= t;
        jumpHeld = t - upSince >= CONFIG.handsUpHold;
      } else { upSince = null; jumpHeld = false; }

      // hands on head: duck while held, after a longer hold
      if (headOn) {
        headSince ??= t;
        if (t - headSince >= CONFIG.onHeadHold) headDuck = true;
      } else { headSince = null; headDuck = false; }

      // squat duck: below the calibrated standing height, held briefly
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

      // body jump: how far the body rose over the last few frames
      hist.push({ t, y: f.coreY });
      while (hist.length && t - hist[0].t > CONFIG.jumpWindow) hist.shift();
      const rise = (hist[0].y - f.coreY) / f.torso;
      debug.rise = rise;
      const free = !ducking && duckSince === null && !upOn && t >= cooldownUntil && t - lastDuckEnd > CONFIG.postDuckLock;
      if (free && rise > CONFIG.jumpRise) {
        out.jump = true;
        cooldownUntil = t + CONFIG.jumpCooldown;
        hist = [];
      }

      out.lane = lane;
      out.jumpHeld = jumpHeld;
      out.ducking = ducking || headDuck;
      return out;
    },
  };
}
