# TODO

- [x] Planking version of the game: shoulder taps + pushups (first pass, untested with a real camera)
- [ ] Plank mode: detect that the user is actually in a plank, and pause when they drop out
- [ ] Make the plank controls better (tap and pushup detection feel, thresholds, calibration)
- [x] Implement power ups (shield, ghost) and a breather; more obstacle types (crystals, rocks, pillars, lasers). More powerups and obstacles could come later
- [ ] Work out how to make it a phone app
- [ ] Integrate bio sensors
  - [ ] Heart rate sensor
  - [ ] Conductive rubber cord stretch sensor for breathing

## Ideas
- [ ] Playtest plank mode with the real camera: add a debug overlay / recording of tap and pushup numbers, then tune `PLANK_CONFIG`
- [ ] Make it readable from 2-3 m away: bigger HUD text and powerup chips, auto-retry countdown on the game-over screen
- [x] Audio: sound effects and music (synthesized, M to mute)
- [x] Hit feedback: screen shake, flash, particles, and the dino is knocked over on death
- [x] Roadside scenery per theme
- [ ] More obstacle and powerup variety: moving drones, magnet, score multiplier, coins to collect
- [ ] Designed obstacle patterns (e.g. a staircase of pillars to weave through), not only random rows
- [ ] Better dino model (it is knocked over on death now, but a proper tumble animation would be better)
- [ ] Obstacle shadows and speed lines as the game gets faster
- [ ] Upper-body mode: work with only part of the body in view, so it doesn't need your feet
- [x] Difficulty slider (road speed multiplier, x0.5 to x2)
- [ ] A simple settings screen, so nothing depends on keyboard shortcuts
- [ ] Squat-before-jump problem (standing mode): crouching to jump shouldn't register as a duck
- [ ] Saved test suite for the gesture logic (plank and standing), so tuning is safer
