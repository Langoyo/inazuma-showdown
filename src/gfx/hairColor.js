// A footballer sprite's hair colour, taken from that player's own pixel
// portrait: the most common colour among the opaque pixels in the top third
// of the picture (where the hair is), leaving out the portraits' dark
// outline. Loaded in the background; callers get DEFAULT_HAIR until it's in.

export const DEFAULT_HAIR = 0x4a3222;
const OUTLINE = [26, 28, 44];
const cache = new Map(); // image url → Promise<colour>

function dominantTopColour(img) {
  const N = 32;
  const c = document.createElement('canvas');
  c.width = N; c.height = N;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(img, 0, 0, N, N);
  const { data } = ctx.getImageData(0, 0, N, Math.ceil(N / 3));
  const counts = new Map();
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] < 200) continue;
    const r = data[i], g = data[i + 1], b = data[i + 2];
    if (Math.abs(r - OUTLINE[0]) + Math.abs(g - OUTLINE[1]) + Math.abs(b - OUTLINE[2]) < 40) continue;
    const key = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4);
    const e = counts.get(key) || { n: 0, r: 0, g: 0, b: 0 };
    e.n++; e.r += r; e.g += g; e.b += b;
    counts.set(key, e);
  }
  let best = null;
  for (const e of counts.values()) if (!best || e.n > best.n) best = e;
  if (!best || best.n < 4) return DEFAULT_HAIR;
  return (Math.round(best.r / best.n) << 16) | (Math.round(best.g / best.n) << 8) | Math.round(best.b / best.n);
}

/** Promise of the hair colour for a roster player (DEFAULT_HAIR when they
 *  have no local portrait, or it fails to load). */
export function hairColorFor(player) {
  const url = player?.image;
  if (!url || /^https?:/.test(url)) return Promise.resolve(DEFAULT_HAIR);
  if (!cache.has(url)) {
    cache.set(url, new Promise((resolve) => {
      const img = new Image();
      img.onload = () => { try { resolve(dominantTopColour(img)); } catch { resolve(DEFAULT_HAIR); } };
      img.onerror = () => resolve(DEFAULT_HAIR);
      img.src = url;
    }));
  }
  return cache.get(url);
}
