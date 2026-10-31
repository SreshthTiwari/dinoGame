# Blip Dash

Top-down runner: switch lanes, jump over spikes, duck under gates. Play with your body (webcam + MediaPipe) or the keyboard.

## Run

The game uses ES modules and the webcam, so it must be served over `http://localhost`, not opened as a file:

```
python3 -m http.server 8000
```

then open http://localhost:8000 and press Space. The browser will ask for camera access.

## Body controls

Stand 2-3 m back with your whole body in view. After pressing Space, the calibration screen walks you through five steps, holding still for each: stand in the LEFT, CENTER and RIGHT lane, raise both hands above your head, then put both hands on your head.

| Action | Body |
|---|---|
| Lane | stand in that lane |
| Jump | jump (fires as you take off), or raise both hands above your head |
| Duck | squat, or put both hands on your head (hold it) |

The dino changes lane once about 60% of your body's width is inside another lane (`laneShare` in `gestures.js`), so you don't have to step all the way over.

Hands above the head jump once per raise: lower your hands to jump again. Body and hand controls both work at the same time, and so do the keys.

## Difficulty

The run gets harder as it goes: over 150 seconds the road speeds up from 300 to 600 px/s, obstacles come closer together, and double-lane rows get more common (LV 1 to LV 10 shown at the top). The dino's legs and tail speed up with it. The numbers are at the top of `js/game.js`.

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
| Show live jump/duck/hand numbers on the preview | D |

Touch: swipe up = jump, down = duck, left/right = lane, tap = jump.

## Layout

- `js/game.js` game logic and drawing
- `js/input/keyboard.js` keyboard + touch
- `js/input/pose.js` webcam + MediaPipe
- `js/input/gestures.js` landmarks to lane / jump / duck, calibration (thresholds in `CONFIG`)
- `js/ui/` calibration screen and camera preview
- `vendor/mediapipe/` MediaPipe tasks-vision 0.10.21, self-hosted
- `models/` pose landmarker (lite) model
