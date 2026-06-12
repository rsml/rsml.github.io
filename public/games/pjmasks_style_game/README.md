# PJ‑Style Sprite Fighter (local HTML)

## Run
Open `index.html` in a browser (Chrome/Edge/Firefox).

If your browser blocks local file image loading, serve the folder:

- Python: `python3 -m http.server 8000`
- Then open: http://localhost:8000

## Controls
- Space: start / confirm
- Arrow Left/Right: choose hero
- U/H: move left/right
- Y: jump
- X: back-jump
- O/P/L: attacks

## Swap in your own sprites
Replace:
- `assets/hero1.png`, `assets/hero2.png`, `assets/hero3.png`
- `assets/slime.png`

Then adjust frame sizes in `initAssets()`.

## Licensing for included placeholder art
- `assets/hero*.png` comes from OpenGameArt “Hero character sprite sheet” (CC0).
- `assets/slime.png` comes from OpenGameArt “Animated Slime” (CC‑BY 3.0) — attribution required.
