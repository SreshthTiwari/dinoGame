// Webcam + MediaPipe pose landmarker. Self-hosted: see vendor/mediapipe and models/.
import { FilesetResolver, PoseLandmarker } from '../../vendor/mediapipe/vision_bundle.mjs';

const WASM_DIR = new URL('../../vendor/mediapipe/wasm', import.meta.url).href;
const MODEL = new URL('../../models/pose_landmarker_lite.task', import.meta.url).href;

export async function createPose(video) {
  const stream = await navigator.mediaDevices.getUserMedia({
    video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: 'user' },
    audio: false,
  });
  video.srcObject = stream;
  await video.play();

  const fileset = await FilesetResolver.forVisionTasks(WASM_DIR);
  const make = delegate => PoseLandmarker.createFromOptions(fileset, {
    baseOptions: { modelAssetPath: MODEL, delegate },
    runningMode: 'VIDEO',
    numPoses: 1,
  });
  let landmarker;
  try { landmarker = await make('GPU'); } catch { landmarker = await make('CPU'); }

  let lastVideoTime = -1, lastTs = 0;
  return {
    aspect: video.videoWidth / video.videoHeight,
    // undefined = no new camera frame yet, null = frame with nobody in it, else 33 landmarks
    detect() {
      if (video.readyState < 2 || video.currentTime === lastVideoTime) return undefined;
      lastVideoTime = video.currentTime;
      let ts = performance.now();
      if (ts <= lastTs) ts = lastTs + 1;   // timestamps must strictly increase
      lastTs = ts;
      return landmarker.detectForVideo(video, ts).landmarks[0] ?? null;
    },
    stop() {
      stream.getTracks().forEach(tr => tr.stop());
      landmarker.close();
    },
  };
}
