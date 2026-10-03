/** Règles pures d'extraction de frames vidéo (testables hors navigateur). */

export const VIDEO_FRAME_TARGET = 10;
/** Nombre d'instants candidats lus : on en lit plus pour écarter noires / doublons. */
export const VIDEO_FRAME_CANDIDATES = 18;

/** Instants (s) répartis sur la vidéo, en évitant le tout début et la toute fin. */
export function candidateTimes(duration: number, n = VIDEO_FRAME_CANDIDATES): number[] {
  const d = Number.isFinite(duration) && duration > 0 ? duration : 3;
  const start = Math.min(0.1, d * 0.05), end = Math.max(start, d - Math.min(0.1, d * 0.05));
  if (n <= 1) return [d / 2];
  return Array.from({ length: n }, (_, i) => +(start + ((end - start) * i) / (n - 1)).toFixed(3));
}

/** Signature réduite d'une frame : luminance moyenne + vignette 8×8 en niveaux de gris. */
export type FrameSig = { mean: number; grid: number[] };

export function signature(rgba: ArrayLike<number>, w: number, h: number): FrameSig {
  const grid = new Array<number>(64).fill(0), cnt = new Array<number>(64).fill(0);
  let sum = 0, n = 0;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 4;
    const l = 0.299 * rgba[i]! + 0.587 * rgba[i + 1]! + 0.114 * rgba[i + 2]!;
    const g = Math.min(7, Math.floor((y * 8) / h)) * 8 + Math.min(7, Math.floor((x * 8) / w));
    grid[g]! += l; cnt[g]!++; sum += l; n++;
  }
  return { mean: n ? sum / n : 0, grid: grid.map((v, i) => (cnt[i] ? v / cnt[i]! : 0)) };
}

export const isBlackFrame = (s: FrameSig) => s.mean < 12;
/** Frames quasi identiques : écart moyen de la vignette < 3 niveaux. */
export function isNearDuplicate(a: FrameSig, b: FrameSig) {
  let diff = 0;
  for (let i = 0; i < 64; i++) diff += Math.abs(a.grid[i]! - b.grid[i]!);
  return diff / 64 < 3;
}

/** Garde les frames utiles (ni noires, ni doublons du précédent retenu), puis en choisit `target` réparties. */
export function selectFrames<T>(items: { sig: FrameSig; value: T }[], target = VIDEO_FRAME_TARGET): T[] {
  const kept: { sig: FrameSig; value: T }[] = [];
  for (const it of items) {
    if (isBlackFrame(it.sig)) continue;
    if (kept.length && isNearDuplicate(kept[kept.length - 1]!.sig, it.sig)) continue;
    kept.push(it);
  }
  if (kept.length <= target) return kept.map((k) => k.value);
  return Array.from({ length: target }, (_, i) => kept[Math.round((i * (kept.length - 1)) / (target - 1))]!.value);
}

/** Type vidéo accepté : MIME video/* ou extension connue (certains téléphones envoient un type vide). */
export function isVideoFile(f: { type: string; name: string }) {
  return f.type.startsWith("video/") || /\.(mp4|m4v|mov|webm|3gp|qt)$/i.test(f.name);
}
