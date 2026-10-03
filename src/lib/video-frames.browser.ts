/** Extraction de frames espacées d'une courte vidéo, côté navigateur (aucun envoi de vidéo brute). */
export async function extractVideoFrames(file: Blob, count = 10, maxSide = 1280, quality = 0.75): Promise<string[]> {
  const url = URL.createObjectURL(file);
  const video = document.createElement("video");
  video.muted = true;
  video.playsInline = true;
  video.preload = "auto";
  video.src = url;
  try {
    await new Promise<void>((ok, ko) => {
      video.onloadeddata = () => ok();
      video.onerror = () => ko(new Error("Vidéo illisible sur cet appareil."));
    });
    const dur = Number.isFinite(video.duration) && video.duration > 0 ? video.duration : 3;
    const scale = Math.min(1, maxSide / Math.max(video.videoWidth || maxSide, video.videoHeight || maxSide));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round((video.videoWidth || maxSide) * scale);
    canvas.height = Math.round((video.videoHeight || maxSide) * scale);
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Extraction impossible.");
    const out: string[] = [];
    for (let i = 0; i < count; i++) {
      const t = Math.min(dur - 0.05, ((i + 0.5) / count) * dur);
      await new Promise<void>((ok) => {
        const done = () => { video.removeEventListener("seeked", done); ok(); };
        video.addEventListener("seeked", done);
        video.currentTime = Math.max(0, t);
        setTimeout(done, 1500);
      });
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      out.push(canvas.toDataURL("image/jpeg", quality));
    }
    return out;
  } finally {
    URL.revokeObjectURL(url);
  }
}
