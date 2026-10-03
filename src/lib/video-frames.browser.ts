/** Extraction de frames d'une courte vidéo, côté navigateur (aucun envoi de vidéo brute). */
import { candidateTimes, selectFrames, signature, VIDEO_FRAME_TARGET } from "./video-frames";

function waitEvent(el: HTMLVideoElement, ok: string, ms: number, label: string) {
  return new Promise<void>((res, rej) => {
    const t = setTimeout(() => { cleanup(); rej(new Error(label)); }, ms);
    const done = () => { cleanup(); res(); };
    const fail = () => { cleanup(); rej(new Error("Vidéo illisible sur cet appareil (format non pris en charge).")); };
    const cleanup = () => { clearTimeout(t); el.removeEventListener(ok, done); el.removeEventListener("error", fail); };
    el.addEventListener(ok, done); el.addEventListener("error", fail);
  });
}

/** Lit durée et dimensions sans extraire (pour l'état « Vidéo prête »). */
export async function probeVideo(file: Blob): Promise<{ duration: number | null }> {
  const url = URL.createObjectURL(file);
  const v = document.createElement("video");
  v.muted = true; v.playsInline = true; v.preload = "metadata"; v.src = url;
  try {
    await waitEvent(v, "loadedmetadata", 8000, "Métadonnées vidéo indisponibles.");
    return { duration: Number.isFinite(v.duration) && v.duration > 0 ? v.duration : null };
  } catch { return { duration: null }; } finally { URL.revokeObjectURL(url); }
}

export async function extractVideoFrames(file: Blob, target = VIDEO_FRAME_TARGET, maxSide = 1280, quality = 0.75): Promise<string[]> {
  const url = URL.createObjectURL(file);
  const video = document.createElement("video");
  video.muted = true; video.defaultMuted = true; video.playsInline = true;
  video.setAttribute("playsinline", ""); video.setAttribute("webkit-playsinline", ""); video.setAttribute("muted", "");
  video.preload = "auto";
  // iOS Safari ne décode pas une vidéo détachée du DOM : on l'attache hors écran.
  video.style.cssText = "position:fixed;left:-9999px;top:0;width:2px;height:2px;opacity:0;pointer-events:none";
  document.body.appendChild(video);
  video.src = url;
  try {
    await waitEvent(video, "loadedmetadata", 10000, "Vidéo non chargée (délai dépassé).");
    // Débloque le décodage sur iOS/Android (lecture muette puis pause).
    try { await video.play(); video.pause(); } catch { /* lecture auto refusée : on tente quand même le seek */ }
    if (video.readyState < 2) await waitEvent(video, "loadeddata", 8000, "Images vidéo non décodées.").catch(() => undefined);
    const vw = video.videoWidth, vh = video.videoHeight;
    if (!vw || !vh) throw new Error("Vidéo sans image lisible sur cet appareil.");
    const scale = Math.min(1, maxSide / Math.max(vw, vh));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(vw * scale); canvas.height = Math.round(vh * scale);
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    const small = document.createElement("canvas"); small.width = 32; small.height = 32;
    const sctx = small.getContext("2d", { willReadFrequently: true });
    if (!ctx || !sctx) throw new Error("Extraction impossible (canvas indisponible).");
    const items: { sig: ReturnType<typeof signature>; value: string }[] = [];
    for (const t of candidateTimes(video.duration)) {
      const seeked = waitEvent(video, "seeked", 2500, "seek");
      video.currentTime = Math.min(t, Math.max(0, (video.duration || t) - 0.05));
      try { await seeked; } catch { continue; }
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      sctx.drawImage(canvas, 0, 0, 32, 32);
      const sig = signature(sctx.getImageData(0, 0, 32, 32).data, 32, 32);
      items.push({ sig, value: canvas.toDataURL("image/jpeg", quality) });
    }
    const frames = selectFrames(items, target);
    if (!frames.length) throw new Error("Aucune image exploitable dans la vidéo (noire ou illisible).");
    return frames;
  } finally {
    video.removeAttribute("src"); video.load(); video.remove();
    URL.revokeObjectURL(url);
  }
}
