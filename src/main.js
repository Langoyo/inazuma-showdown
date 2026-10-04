import Phaser from 'phaser';
import GameScene from './scenes/GameScene.js';
// Base pixel-UI components (buttons, panels) for the HUD/menus — see
// index.html for the retro theme layered on top of it.
import 'nes.css/css/nes.min.css';

// The logical field is 960×1520 — a big vertical pitch the camera scrolls
// over. The canvas itself always fills the whole browser viewport (RESIZE
// mode), so on a landscape screen the game genuinely uses all the
// available space instead of being letterboxed into a fixed phone-shaped
// window. GameScene keeps its own VP_W/VP_H in sync via the 'resize' event.
const config = {
  type: Phaser.AUTO,
  parent: 'game-container',
  // The match is drawn in pixel art (see src/gfx/pixelArt.js): nearest-
  // neighbour scaling and whole-pixel positions keep it crisp.
  pixelArt: true,
  backgroundColor: '#0b3d1f',
  scale: {
    mode: Phaser.Scale.RESIZE,
    autoCenter: Phaser.Scale.CENTER_BOTH,
    width: window.innerWidth,
    height: window.innerHeight
  },
  physics: {
    default: 'matter',
    matter: { gravity: { y: 0 }, debug: false }
  },
  input: { activePointers: 2 },
  scene: [GameScene]
};

const game = new Phaser.Game(config);

// Dev-only hook so the Playwright suite (and manual debugging) can reach
// into live scene state — Vite strips this whole block out of
// `vite build`'s production output (import.meta.env.DEV is inlined to
// `false`), so it never ships to players.
if (import.meta.env.DEV) {
  window.__game = game;
  Object.defineProperty(window, '__scene', {
    get: () => game.scene.keys.GameScene || game.scene.scenes[0]
  });
}
