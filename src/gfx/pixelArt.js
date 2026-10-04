// Pixel-art textures for the match, painted in code at load time: the
// footballers (with their run cycle), the ball, the pitch and goals, and the
// little markers/rings the effects use. Nothing here touches game state —
// GameScene calls ensurePixelTextures(scene, layout) once and then just
// refers to the texture keys below.
//
// One art pixel is ART_SCALE world pixels; the sprites are drawn with
// setScale(ART_SCALE) and Phaser's pixelArt mode keeps them crisp.

export const ART_SCALE = 2;

// ---- footballer ------------------------------------------------------------
// 12×16, facing right (flipped for left). The three layers come from the
// same maps so they always line up:
//   base — outline, skin, eyes, shorts, boots (drawn as is)
//   kit  — jersey and socks, white, tinted with the team colour
//   hair — white, tinted with each player's own hair colour
// k/K and h/H are the light and shaded halves of the tinted parts.
export const PLAYER_W = 12, PLAYER_H = 16;
export const PLAYER_FRAMES = ['idle', 'run1', 'run2', 'run3'];
// The run cycle plays run1 → run2 → run3 → run2.
export const RUN_CYCLE = ['run1', 'run2', 'run3', 'run2'];

const HEAD = [
  '....oooo....',
  '...ohhhhoo..',
  '..ohhhhhhho.',
  '..ohhhhssso.',
  '..ohhhsseso.',
  '...osssssso.',
  '....ossso...',
];
const PLAYER_MAPS = {
  idle: [...HEAD,
    '..okkkkkkko.',
    '.oskkkkkkkso',
    '.oskkkkkkkso',
    '..oKKKKKKKo.',
    '..owwwwwwwo.',
    '...owwoowwo.',
    '...oko..oko.',
    '...obbo.obbo',
  ],
  run1: [...HEAD,
    '..okkkkkkkso',
    '.oskkkkkkkso',
    'ooskkkkkkko.',
    '..oKKKKKKKo.',
    '..owwwwwwwo.',
    '..owwo.owwo.',
    '.oko....okoo',
    '.obbo....obb',
  ],
  run2: [...HEAD,
    '..okkkkkkko.',
    '..okskkkkko.',
    '..okskkkkko.',
    '..oKKKKKKKo.',
    '..owwwwwwwo.',
    '...owwwwwo..',
    '....okokko..',
    '....obbobbo.',
  ],
  run3: [...HEAD,
    '.sokkkkkkko.',
    '.oskkkkkkkso',
    '..okkkkkkkso',
    '..oKKKKKKKo.',
    '..owwwwwwwo.',
    '..owwo.owwo.',
    '.oko....oko.',
    'obbo....obbo',
  ],
};
const BASE_PAL = {
  o: '#1a1a2e', s: '#f2c19b', e: '#1e1e28', w: '#2b2d42', b: '#2a2a2a', g: '#c6ff4a',
};
const TINT_PAL = { k: '#ffffff', K: '#b4b4b4', h: '#ffffff', H: '#a8a8a8' };

export const TEX = {
  plBase: 'px-pl-base', plKeeper: 'px-pl-keeper', plKit: 'px-pl-kit', plHair: 'px-pl-hair',
  ball: 'px-ball', shadow: 'px-shadow', ring: 'px-ring', ellipse: 'px-ellipse', arrow: 'px-arrow',
  pitch: 'px-pitch',
};

/** A canvas texture holding `frames` (name → string rows) side by side, each
 *  drawn through `pick(char, row)` → a CSS colour or null for transparent. */
function sheet(scene, key, frames, pick) {
  if (scene.textures.exists(key)) return;
  const names = Object.keys(frames);
  const w = frames[names[0]][0].length, h = frames[names[0]].length;
  const tex = scene.textures.createCanvas(key, w * names.length, h);
  const ctx = tex.getContext();
  names.forEach((name, i) => {
    frames[name].forEach((row, y) => [...row].forEach((c, x) => {
      const col = pick(c, y);
      if (col) { ctx.fillStyle = col; ctx.fillRect(i * w + x, y, 1, 1); }
    }));
    tex.add(name, 0, i * w, 0, w, h);
  });
  tex.refresh();
}

function makePlayers(scene) {
  sheet(scene, TEX.plBase, PLAYER_MAPS, (c) => BASE_PAL[c] || null);
  // Keepers: the same body with gloves on (hands are the skin pixels below the head).
  sheet(scene, TEX.plKeeper, PLAYER_MAPS, (c, y) => (c === 's' && y >= HEAD.length ? BASE_PAL.g : BASE_PAL[c] || null));
  sheet(scene, TEX.plKit, PLAYER_MAPS, (c) => (c === 'k' || c === 'K' ? TINT_PAL[c] : null));
  sheet(scene, TEX.plHair, PLAYER_MAPS, (c) => (c === 'h' || c === 'H' ? TINT_PAL[c] : null));
}

// ---- ball --------------------------------------------------------------------
// 10×10, the classic black patches on white, four frames that roll the
// patches round so the ball spins as it moves.
export const BALL_N = 10, BALL_FRAMES = 4;
function makeBall(scene) {
  if (scene.textures.exists(TEX.ball)) return;
  const N = BALL_N, C = (N - 1) / 2, R = N / 2 - 0.2;
  const patches = [[0, 1], [4, 2], [8, 1], [2, 5], [6, 4], [10, 6], [0, 8], [4, 7], [8, 8]]; // (u, v) on a 12-wide band
  const tex = scene.textures.createCanvas(TEX.ball, N * BALL_FRAMES, N);
  const ctx = tex.getContext();
  for (let f = 0; f < BALL_FRAMES; f++) {
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      const d = Math.hypot(x - C, y - C);
      if (d > R) continue;
      let col;
      if (d > R - 1.05) col = '#28282f';
      else {
        const u = (x + f * 3) % 12;
        const black = patches.some(([pu, pv]) => ((u - pu + 12) % 12) <= 1 && (y - pv === 0 || y - pv === 1));
        col = black ? '#222228' : (x + y > N + 1 ? '#e6e6e6' : '#ffffff');
      }
      ctx.fillStyle = col; ctx.fillRect(f * N + x, y, 1, 1);
    }
    tex.add(`b${f}`, 0, f * N, 0, N, N);
  }
  tex.refresh();
}

// ---- markers -------------------------------------------------------------------
/** Pixels of an ellipse outline (rx, ry in art px) centred in a w×h grid. */
function ellipsePixels(w, h, rx, ry) {
  const cx = (w - 1) / 2, cy = (h - 1) / 2, out = new Set();
  for (let a = 0; a < Math.PI * 2; a += 0.01) out.add(`${Math.round(cx + rx * Math.cos(a))},${Math.round(cy + ry * Math.sin(a))}`);
  return [...out].map((s) => s.split(',').map(Number));
}
function shape(scene, key, w, h, draw) {
  if (scene.textures.exists(key)) return;
  const tex = scene.textures.createCanvas(key, w, h);
  draw(tex.getContext());
  tex.refresh();
}
function makeMarkers(scene) {
  // A soft-edged shadow under each player and the ball.
  shape(scene, TEX.shadow, 8, 3, (ctx) => {
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.fillRect(1, 0, 6, 3); ctx.fillRect(0, 1, 8, 1);
  });
  // A white ring (tinted per use): technique and save bursts.
  shape(scene, TEX.ring, 16, 16, (ctx) => {
    ctx.fillStyle = '#ffffff';
    for (const [x, y] of ellipsePixels(16, 16, 7, 7)) ctx.fillRect(x, y, 1, 1);
  });
  // The flattened ring under the feet of the player you're steering.
  shape(scene, TEX.ellipse, 13, 5, (ctx) => {
    ctx.fillStyle = '#ffffff';
    for (const [x, y] of ellipsePixels(13, 5, 6, 2)) ctx.fillRect(x, y, 1, 1);
  });
  // The little arrow bobbing over the ball carrier (tinted gold).
  shape(scene, TEX.arrow, 7, 5, (ctx) => {
    const rows = ['ooooooo', 'oxxxxxo', '.oxxxo.', '..oxo..', '...o...'];
    rows.forEach((r, y) => [...r].forEach((c, x) => {
      if (c === '.') return;
      ctx.fillStyle = c === 'o' ? '#5a4500' : '#ffffff'; ctx.fillRect(x, y, 1, 1);
    }));
  });
}

// ---- pitch & goals -----------------------------------------------------------------
/** The whole ground, run-off included, at half resolution: mown stripes, a
 *  light speckle, chunky white markings and the two goal nets. World layout
 *  in: { fieldW, fieldH, runoff, goalHalfWidth, goalDepth, paW, paH }. The
 *  image's top-left is world (0, -runoff). */
function makePitch(scene, L) {
  if (scene.textures.exists(TEX.pitch)) return;
  const A = ART_SCALE;
  const W = Math.round(L.fieldW / A), top = Math.round(L.runoff / A), FH = Math.round(L.fieldH / A);
  const H = FH + top * 2;
  const tex = scene.textures.createCanvas(TEX.pitch, W, H);
  const ctx = tex.getContext();
  const fill = (col, x, y, w = 1, h = 1) => { ctx.fillStyle = col; ctx.fillRect(x, y, w, h); };

  // Stripes, every 40 art px (80 world), lighter on the field than on the apron.
  const BAND = 40;
  for (let y = 0; y < H; y++) {
    const onField = y >= top && y < top + FH;
    const light = Math.floor((y - top + BAND * 100) / BAND) % 2 === 0;
    fill(onField ? (light ? '#2f8f47' : '#2a8342') : (light ? '#1e6633' : '#1b5e2f'), 0, y, W, 1);
  }
  // A light speckle so the grass isn't flat (seeded: the same every load).
  let seed = 1234567;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  for (let i = 0; i < W * H * 0.03; i++) {
    const x = Math.floor(rnd() * W), y = Math.floor(rnd() * H);
    fill(rnd() < 0.5 ? 'rgba(255,255,255,0.10)' : 'rgba(0,0,0,0.10)', x, y);
  }

  const LINE = '#f2f2f2';
  const hline = (x0, x1, y) => fill(LINE, x0, y - 1, x1 - x0, 2);
  const vline = (x, y0, y1) => fill(LINE, x - 1, y0, 2, y1 - y0);
  const rect = (x0, y0, x1, y1) => { hline(x0, x1, y0 + 1); hline(x0, x1, y1); vline(x0 + 1, y0, y1); vline(x1, y0, y1); };
  const arc = (cx, cy, r, keep = () => true) => {
    for (let a = 0; a < Math.PI * 2; a += 0.004) for (const rr of [r, r - 1]) {
      const x = Math.round(cx + rr * Math.cos(a)), y = Math.round(cy + rr * Math.sin(a));
      if (x >= 0 && x < W && keep(x, y)) fill(LINE, x, y);
    }
  };
  const y0 = top, y1 = top + FH, cx = W / 2;
  // Touchlines and goal lines, halfway line, centre circle and spot.
  rect(0, y0 - 1, W - 1, y1);
  hline(0, W, y0 + FH / 2);
  arc(cx - 0.5, y0 + FH / 2 - 0.5, Math.round(60 / A));
  fill(LINE, cx - 2, y0 + FH / 2 - 2, 4, 4);
  // Penalty areas, goal areas, spots and the arcs outside the box.
  const paW = Math.round(L.paW / A), paH = Math.round(L.paH / A);
  const gaW = Math.round(L.goalHalfWidth * 4 / A), gaH = Math.round(60 / A);
  const spot = Math.round(120 / A), dR = Math.round(100 / A); // the "D": spot 11m, radius 9.15m, box 16.5m
  for (const [line, dir] of [[y0, 1], [y1, -1]]) {
    const far = line + dir * paH, gFar = line + dir * gaH;
    rect(cx - paW / 2, Math.min(line, far), cx + paW / 2, Math.max(line, far));
    rect(cx - gaW / 2, Math.min(line, gFar), cx + gaW / 2, Math.max(line, gFar));
    const sy = line + dir * spot;
    fill(LINE, cx - 1, sy - 1, 3, 3);
    arc(cx - 0.5, sy, dR, (x, y) => (dir > 0 ? y > far + 1 : y < far - 1));
  }
  // Corner arcs.
  for (const [ccx, ccy] of [[0, y0], [W, y0], [0, y1], [W, y1]]) arc(ccx, ccy, 5, (x, y) => y >= y0 && y <= y1);

  // Goals: a net (lightened grass with a grid) inside chunky white posts.
  const gw = Math.round(L.goalHalfWidth * 2 / A), gd = Math.round(L.goalDepth / A);
  for (const [line, dir] of [[y0, -1], [y1, 1]]) {
    const gx0 = Math.round(cx - gw / 2), gy0 = dir < 0 ? line - gd : line, gy1 = dir < 0 ? line : line + gd;
    fill('rgba(255,255,255,0.16)', gx0, gy0, gw, gy1 - gy0);
    for (let x = gx0 + 4; x < gx0 + gw; x += 4) fill('rgba(255,255,255,0.28)', x, gy0, 1, gy1 - gy0);
    for (let y = gy0 + 4; y < gy1; y += 4) fill('rgba(255,255,255,0.28)', gx0, y, gw, 1);
    fill('#ffffff', gx0 - 2, gy0, 2, gy1 - gy0);          // posts
    fill('#ffffff', gx0 + gw, gy0, 2, gy1 - gy0);
    fill('#ffffff', gx0 - 2, dir < 0 ? gy0 : gy1 - 2, gw + 4, 2); // back of the net
    fill('#ffffff', gx0 - 2, line - 2, gw + 4, 3);       // the goal line itself, thicker
  }
  tex.refresh();
}

/** Every texture the match draws with, created once (later calls are no-ops). */
export function ensurePixelTextures(scene, layout) {
  makePlayers(scene);
  makeBall(scene);
  makeMarkers(scene);
  makePitch(scene, layout);
}

/** A colour shaded towards black by `f` (0..1) — keepers' darker kit. */
export function shade(color, f) {
  const r = (color >> 16) & 255, g = (color >> 8) & 255, b = color & 255;
  const k = 1 - f;
  return (Math.round(r * k) << 16) | (Math.round(g * k) << 8) | Math.round(b * k);
}
