// Draws lane bands and the skeleton on the canvas that sits over the webcam video.
// The <video> is mirrored with CSS, so landmarks are mirrored here to match.
const LANE_LABELS = ['LEFT', 'CENTER', 'RIGHT'];
const BONES = [[11, 12], [11, 13], [13, 15], [12, 14], [14, 16], [11, 23], [12, 24], [23, 24], [23, 25], [25, 27], [24, 26], [26, 28]];

// opts: { bounds: [x, x] lane edges (default thirds), active: lane index to highlight,
//         labels: bool, debug: string to print }
export function drawPreview(canvas, video, landmarks, opts = {}) {
  const w = video.videoWidth, h = video.videoHeight;
  if (!w) return;
  if (canvas.width !== w) canvas.width = w;
  if (canvas.height !== h) canvas.height = h;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, w, h);

  const edges = [0, ...(opts.bounds || [1 / 3, 2 / 3]), 1];
  const font = Math.round(h * 0.06);
  for (let i = 0; i < 3; i++) {
    const x0 = edges[i] * w, x1 = edges[i + 1] * w;
    ctx.fillStyle = opts.active === i ? 'rgba(94,242,200,0.25)' : 'rgba(255,255,255,0.05)';
    ctx.fillRect(x0, 0, x1 - x0, h);
    if (opts.labels) {
      ctx.fillStyle = opts.active === i ? '#5ef2c8' : 'rgba(232,228,255,0.6)';
      ctx.font = `bold ${font}px monospace`; ctx.textAlign = 'center';
      ctx.fillText(LANE_LABELS[i], (x0 + x1) / 2, font * 1.4);
    }
  }
  ctx.fillStyle = 'rgba(255,255,255,0.4)';
  ctx.fillRect(edges[1] * w - 1, 0, 2, h); ctx.fillRect(edges[2] * w - 1, 0, 2, h);

  if (landmarks) {
    const px = p => (1 - p.x) * w, py = p => p.y * h;
    ctx.strokeStyle = '#ff5d8f'; ctx.lineWidth = Math.max(2, h * 0.008);
    ctx.beginPath();
    for (const [a, b] of BONES) { ctx.moveTo(px(landmarks[a]), py(landmarks[a])); ctx.lineTo(px(landmarks[b]), py(landmarks[b])); }
    ctx.stroke();
    ctx.fillStyle = '#ffd35e';
    ctx.beginPath(); ctx.arc(px(landmarks[0]), py(landmarks[0]), h * 0.015, 0, 7); ctx.fill();
  }

  if (opts.debug) {
    ctx.fillStyle = '#fff'; ctx.font = `${Math.round(h * 0.05)}px monospace`; ctx.textAlign = 'left';
    ctx.fillText(opts.debug, 6, h - 8);
  }
}
