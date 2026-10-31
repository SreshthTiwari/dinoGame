# Blip Dash

Top-down runner: switch lanes, jump over spikes, duck under gates. Play with your body (webcam + MediaPipe) or the keyboard.

## Run

The game uses ES modules and the webcam, so it must be served over `http://localhost`, not opened as a file:

```
python3 -m http.server 8000
```

then open http://localhost:8000 and press Space. The browser will ask for camera access.

## Body controls

Stand 2-3 m back with your whole body in view. After pressing Space, the calibration screen asks you to step into the LEFT, CENTER and RIGHT lane and hold still in each.

| Action | Body |
|---|---|
| Lane | stand in that lane |
| Jump | jump (fires as you take off) |
| Duck | squat |

## Keys

| Action | Keys |
|---|---|
| Start / retry | Space, Up, Left/Right or Down |
| Jump | Space / Up / W |
| Duck | hold Down / S |
| Lane | Left / Right or A / D |
| Recalibrate camera | C (when not mid-run) |
| Keyboard only | Esc |
| Show/hide camera preview | V |
| Show jump/duck debug numbers | D |

Touch: swipe up = jump, down = duck, left/right = lane, tap = jump.

## Layout

- `js/game.js` game logic and drawing
- `js/input/keyboard.js` keyboard + touch
- `js/input/pose.js` webcam + MediaPipe
- `js/input/gestures.js` landmarks to lane / jump / duck, calibration (thresholds in `CONFIG`)
- `js/ui/` calibration screen and camera preview
- `vendor/mediapipe/` MediaPipe tasks-vision 0.10.21, self-hosted
- `models/` pose landmarker (lite) model
