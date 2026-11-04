# Blip Dash

3D runner: switch lanes, hop crystals and rocks, duck under gates and lasers, dodge pillars. Play with your body (webcam + MediaPipe) or the keyboard.

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
| Jump | jump (fires as you take off), or keep both hands above your head to keep jumping |
| Duck | squat, or put both hands on your head (hold it) |

The dino changes lane once about 60% of your body's width is inside another lane (`laneShare` in `gestures.js`), so you don't have to step all the way over.

Keep your hands above your head and the dino keeps jumping, landing and jumping again, until you lower them. Keep your hands on your head and it stays ducked. Body and hand controls both work at the same time, and so do the keys.

## Plank mode

Plank mode is the default. Press P on the start screen to switch between it and standing mode. Put the camera in front of you at floor level and get into a plank facing it. Calibration is two steps: hold the plank still, then lower into a pushup and hold the bottom. The game assumes you are planking; it doesn't check.

| Action | Body |
|---|---|
| Lane left / right | tap your LEFT / RIGHT shoulder with the opposite hand (one lane per tap) |
| Duck | pushup (ducks while you're down) |

Plank mode has no jumping, so its crystals and rocks have to be dodged by lane, like pillars, and it leans on gates (pushups). Numbers are in `PLANK_CONFIG` in `plank.js`; D shows them live on the preview.

## Looks

The game is drawn in real 3D with three.js, from a chase camera behind the dino. The sliders in the bottom-left move the camera (height, distance, how far ahead it looks, field of view, how much it follows your lane); your changes are remembered, the Reset button goes back to the defaults (height 160, distance 330, look ahead 460, FOV 58, follow 1; `THREE_DEFAULTS` in `three.js`), and H hides them.

The world has colour themes (Neon Night, Sunset Drive, Sunny Day, Desert Dusk, Arctic, Candy Land, Matrix). The game always starts on Auto. Click the button in the top-left or press T to cycle (a theme you pick lasts until you reload). The last stop in the cycle is **Auto**, which changes the world as you play: a new theme every 20 seconds of a run, cross-fading over 2.5 seconds, in the order above and then around again (`AUTO` in `themes.js`). To make your own theme, add an entry to `js/render/themes.js`.

### Roadside scenery

Each theme has its own scenery along both sides of the road, scrolling past with it: neon towers, sunset palms and mountains, trees and hills, cacti and mesas, snowy pines and ice crystals, lollipops and gumdrops, columns of falling code. When the theme changes, the new props start arriving from the horizon while the old ones drive past, so the world changes along the road. Props are in `js/render/scenery.js` (add or change builders and the per-theme `SETS` there).

## Sound and hit feedback

Sound is synthesized in the browser (`js/audio.js`, no audio files): effects for lane changes, jumps, ducks, pickups, a shield breaking, the breather, level-ups and dying, plus a music loop that gets faster and busier as the level rises, slows down during the breather, and changes key with each theme. Press M (or click the button under the theme button) to cycle sound + music, sound effects only, silent. Browsers only allow sound after a key press or click, so it starts with your first Space.

Hits have feedback too: the camera shakes and the screen flashes on death or a shield break, particles burst when you pick something up, a shield pops or you die, and the dino is knocked over when it dies. These are driven by game events (`game.on('die', ...)` in `js/main.js`).

## Obstacles

| Obstacle | What to do |
|---|---|
| Crystals, rocks (low) | hop them (standing mode), or change lane |
| Gate, laser (overhead) | duck (squat / pushup) |
| Pillar (tall) | change lane: nothing else gets you past it |

Obstacles are created far up the road (`SPAWN_AHEAD` in `game.js`), out in the haze, and fade into view as they come toward you; the haze is tuned by `FOG_START` in `three.js`. Rows block one or two lanes, so there is always a free lane. The mix is set by `MIX` at the top of `js/game.js` (plank mode has more gates).

## Powerups

Run through a floating gem in your lane to pick it up. One shows up every 14-22 seconds, in a free lane.

- **Shield** (cyan, shows as a bubble round the dino): absorbs the next hit and smashes the obstacle. You can't be hit again for 0.8 s afterwards.
- **Ghost** (white-purple): for 5 seconds the dino is see-through and passes through everything. It blinks when it is about to run out.

## Breather

Every 60 seconds of play the world eases down to 55% speed for 10 seconds, a short break, with a BREATHER banner and timer. Then it speeds back up. It isn't a pickup, and the dino's own moves (lane changes, ducking) stay at normal speed. Tune it with `BREATHER_*` at the top of `js/game.js`.

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
| Standing / plank mode | P (when not mid-run) |
| Keyboard only | Esc |
| Show/hide camera preview | V |
| Change colour theme (three.js look) | T, or the button top-left |
| Cycle sound + music / effects only / silent | M, or the button top-left |
| Show/hide the camera sliders | H |
| Show live jump/duck/hand numbers on the preview | D |

Touch: swipe up = jump, down = duck, left/right = lane, tap = jump.

## Layout

- `js/game.js` game logic (no drawing); `getView()` hands renderers a snapshot of the frame
- `js/audio.js` synthesized sound effects and music; `js/render/scenery.js` roadside props per theme
- `js/render/three.js` the 3D scene (dino, obstacles, powerups, road, camera, particles, shake and flash); `js/render/themes.js` colour themes (pure data: sky, road, dino, obstacles, lighting); `js/render/hud.js` score, powerup chips and title text, drawn on the 2D canvas over the 3D one
- `js/input/keyboard.js` keyboard + touch
- `js/input/pose.js` webcam + MediaPipe
- `js/input/gestures.js` landmarks to lane / jump / duck, calibration (thresholds in `CONFIG`)
- `js/input/plank.js` plank mode: shoulder taps and pushups, calibration (thresholds in `PLANK_CONFIG`)
- `js/ui/` calibration screen and camera preview
- `vendor/mediapipe/` MediaPipe tasks-vision 0.10.21, self-hosted
- `vendor/three/` three.js r160, self-hosted
- `models/` pose landmarker (lite) model
