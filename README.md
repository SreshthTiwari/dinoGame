# Blip Dash

Top-down runner: switch lanes, jump over spikes, duck under gates.

## Run

The game uses ES modules (and later the webcam), so it must be served over `http://localhost`, not opened as a file:

```
python3 -m http.server 8000
```

then open http://localhost:8000.

## Controls

| Action | Keys |
|---|---|
| Start / retry | Space, Up, Left/Right or Down |
| Jump | Space / Up / W |
| Duck | hold Down / S |
| Lane | Left / Right or A / D |

Touch: swipe up = jump, down = duck, left/right = lane, tap = jump.
