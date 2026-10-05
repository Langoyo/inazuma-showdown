import { defineConfig } from 'vite';

export default defineConfig({
  // Vite's default build target predates top-level await support (used in
  // src/network/network.js to fetch TURN credentials once, before the app
  // ever tries to open a P2P room — see that file for why it has to be
  // ready before the first join, not just kicked off in the background).
  // es2022 covers Chrome/Edge 94+, Firefox 93+, Safari 16.4+ — all already
  // required for WebRTC/Web Audio, which this game already depends on.
  build: {
    target: 'es2022'
  },
  // src/network/fastTorrent.js imports Trystero's own source files by path
  // (they aren't in its package "exports"), so the dev server serves them
  // as-is instead of pre-bundling Trystero. Their WebRTC dependency is
  // CommonJS underneath and only works pre-bundled, so it's listed here.
  optimizeDeps: {
    include: ['@thaunknown/simple-peer']
  },
  server: {
    host: true, // para poder probar desde el móvil en la misma red local
    port: 5173
  }
});
