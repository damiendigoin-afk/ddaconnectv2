import { wearLevel } from "./tire-step";

/**
 * Photo annotée pour le devis : la VRAIE photo de bande de roulement + les trois profondeurs
 * (mêmes positions et couleurs que la superposition à l'écran). Aucune image générée par IA.
 */
export async function renderAnnotatedTread(src: string, values: (number | null)[], labels: string[], maxSide = 1280): Promise<string> {
  const img = await new Promise<HTMLImageElement>((res, rej) => {
    const i = new Image();
    i.onload = () => res(i);
    i.onerror = rej;
    i.src = src;
  });
  const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
  const w = Math.round(img.width * scale), h = Math.round(img.height * scale);
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  const ctx = c.getContext("2d");
  if (!ctx) return src;
  ctx.drawImage(img, 0, 0, w, h);
  // Couleurs d'état (canvas : valeurs fixes, identiques à la légende du devis).
  const color = (v: number | null) => {
    const l = wearLevel(v);
    return l === "critique" ? "#dc2626" : l === "surveiller" ? "#f59e0b" : l === "bon" ? "#16a34a" : "#6b7280";
  };
  const fs = Math.max(14, Math.round(w / 28));
  [1 / 6, 1 / 2, 5 / 6].forEach((fx, i) => {
    const x = Math.round(w * fx), v = values[i] ?? null, col = color(v);
    ctx.fillStyle = col;
    ctx.globalAlpha = 0.85;
    ctx.fillRect(x - 3, fs * 3, 6, h - fs * 4);
    ctx.globalAlpha = 1;
    ctx.beginPath(); ctx.arc(x, h - fs, fs / 2, 0, Math.PI * 2); ctx.fill();
    const t1 = (labels[i] ?? "").toUpperCase();
    const t2 = v === null ? "—" : `${v.toLocaleString("fr-FR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })} mm`;
    ctx.font = `bold ${fs}px sans-serif`;
    const bw = Math.max(ctx.measureText(t1).width, ctx.measureText(t2).width) + fs;
    ctx.fillRect(x - bw / 2, fs * 0.4, bw, fs * 2.6);
    ctx.fillStyle = "#ffffff";
    ctx.textAlign = "center";
    ctx.font = `bold ${Math.round(fs * 0.7)}px sans-serif`;
    ctx.fillText(t1, x, fs * 1.3);
    ctx.font = `bold ${fs}px sans-serif`;
    ctx.fillText(t2, x, fs * 2.5);
  });
  return c.toDataURL("image/jpeg", 0.82);
}
