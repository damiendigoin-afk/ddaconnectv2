import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

import ddaRenaultLogo from "@/assets/dda-renault-logo.jpeg.asset.json";

import { assertUsablePdf } from "./tour-notify-core";

/**
 * Génération du PDF complet d'un Tour Véhicule.
 *
 * Module isolé volontairement : c'est la seule partie de la notification Front
 * Office qui dépend de pdf-lib et du téléchargement des photos. Il est importé
 * dynamiquement pour qu'une défaillance de génération (dépendance, photo,
 * mémoire) n'empêche jamais l'e-mail de partir.
 */

type Row = Record<string, unknown>;

function s(v: unknown): string {
  return typeof v === "string" ? v : typeof v === "number" ? String(v) : "";
}

const STATUS_FR: Record<string, string> = {
  ok: "OK",
  watch: "A surveiller",
  defect: "Defaut",
  unset: "Non renseigne",
};

/** Nettoie le texte pour la police PDF standard (WinAnsi). */
function pdfText(v: string): string {
  return v
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\x20-\x7E]/g, " ");
}

/** URL absolue du logo officiel utilisé dans le PDF. */
export function tourLogoUrl(origin: string): string {
  return new URL(ddaRenaultLogo.url, `${origin}/`).toString();
}

type AnyClient = {
  storage: {
    from: (b: string) => {
      createSignedUrl: (p: string, e: number) => Promise<{ data: { signedUrl: string } | null }>;
    };
  };
};

export async function buildTourPdf(args: {
  sb: unknown;
  insp: Row;
  points: Row[];
  observations: Row[];
  media: Row[];
  plate: string;
  clientName: string;
  inspectionId: string;
  logoUrl: string;
}): Promise<{ base64: string; photoCount: number }> {
  const sb = args.sb as AnyClient;
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const A4: [number, number] = [595, 842];
  const margin = 40;
  let page = pdf.addPage(A4);
  let y = A4[1] - margin;

  const newPage = () => {
    page = pdf.addPage(A4);
    y = A4[1] - margin;
  };
  const need = (h: number) => {
    if (y - h < margin) newPage();
  };
  const line = (text: string, size = 10, isBold = false) => {
    need(size + 6);
    page.drawText(pdfText(text).slice(0, 120), {
      x: margin,
      y: y - size,
      size,
      font: isBold ? bold : font,
      color: rgb(0, 0, 0),
    });
    y -= size + 6;
  };

  // Le logo est un confort : son indisponibilité ne doit pas priver le Front
  // Office du compte-rendu.
  try {
    const logoResponse = await fetch(args.logoUrl);
    if (!logoResponse.ok) throw new Error(`Logo officiel inaccessible (${logoResponse.status})`);
    const logoBytes = new Uint8Array(await logoResponse.arrayBuffer());
    const logo = await pdf.embedJpg(logoBytes);
    const logoScale = Math.min(210 / logo.width, 58 / logo.height);
    page.drawImage(logo, {
      x: margin,
      y: y - logo.height * logoScale,
      width: logo.width * logoScale,
      height: logo.height * logoScale,
    });
    y -= logo.height * logoScale + 14;
  } catch (e) {
    console.error("[tour-pdf] logo indisponible", e);
  }

  line("RAPPORT DE TOUR VEHICULE", 16, true);
  line(`${args.plate} — ${args.clientName}`, 12, true);
  line(`Reference du tour : ${args.inspectionId}`, 7);
  const finished = s(args.insp["finished_at"]) || s(args.insp["completed_at"]);
  if (finished) line(`Termine le ${new Date(finished).toLocaleString("fr-FR")}`);
  if (args.insp["mileage"]) line(`Kilometrage : ${Number(args.insp["mileage"]).toLocaleString("fr-FR")} km`);
  if (args.insp["completed_by_name"]) line(`Operateur : ${s(args.insp["completed_by_name"])}`);
  const dur = args.insp["duration_seconds"];
  if (typeof dur === "number") line(`Duree : ${Math.floor(dur / 60)} min ${dur % 60} s`);
  y -= 8;

  if (args.points.length) {
    line("POINTS CONTROLES", 12, true);
    for (const p of args.points) {
      const extra = [
        p["measure_value"] ? `${s(p["measure_value"])} ${s(p["measure_unit"])}`.trim() : "",
        s(p["comment"]),
      ]
        .filter(Boolean)
        .join(" — ");
      line(
        `${s(p["zone_label"])} / ${s(p["point_label"])} : ${STATUS_FR[s(p["status"])] ?? s(p["status"])}${
          extra ? ` — ${extra}` : ""
        }`,
        9,
      );
    }
    y -= 8;
  }

  if (args.observations.length) {
    line("OBSERVATIONS", 12, true);
    for (const o of args.observations) {
      line(
        `${s(o["category"])} / ${s(o["element"])} : ${STATUS_FR[s(o["status"])] ?? s(o["status"])}${
          s(o["comment"]) ? ` — ${s(o["comment"])}` : ""
        }`,
        9,
      );
    }
    y -= 8;
  }

  const labelFor = (m: Row): string => {
    const p = args.points.find((x) => x["id"] === m["inspection_point_id"]);
    if (p) return `${s(p["zone_label"])} / ${s(p["point_label"])}`;
    const o = args.observations.find((x) => x["id"] === m["observation_id"]);
    if (o) return `${s(o["category"])} / ${s(o["element"])}`;
    return s(m["label"]) || "Autre photo du tour";
  };

  const linked = args.media.filter((m) => m["inspection_point_id"] || m["observation_id"]);
  const others = args.media.filter((m) => !m["inspection_point_id"] && !m["observation_id"]);

  let photoCount = 0;
  const drawPhotos = async (rows: Row[], title: string) => {
    if (!rows.length) return;
    line(title, 12, true);
    const cols = 2;
    const cellW = (A4[0] - margin * 2 - 12) / cols;
    const cellH = 150;
    let col = 0;
    for (const m of rows) {
      const path = s(m["thumb_path"]) || s(m["storage_path"]);
      if (!path) continue;
      let bytes: Uint8Array | null = null;
      try {
        const { data } = await sb.storage.from("dda-media").createSignedUrl(path, 600);
        if (data?.signedUrl) {
          const res = await fetch(data.signedUrl);
          if (res.ok) bytes = new Uint8Array(await res.arrayBuffer());
        }
      } catch (e) {
        console.error("[tour-pdf] photo illisible", path, e);
      }
      if (!bytes) continue;
      let img;
      try {
        img = await pdf.embedJpg(bytes);
      } catch {
        try {
          img = await pdf.embedPng(bytes);
        } catch (e) {
          console.error("[tour-pdf] format photo non supporte", path, e);
          continue;
        }
      }
      if (col === 0) need(cellH + 14);
      const x = margin + col * (cellW + 12);
      const scale = Math.min(cellW / img.width, cellH / img.height);
      page.drawImage(img, {
        x,
        y: y - img.height * scale,
        width: img.width * scale,
        height: img.height * scale,
      });
      page.drawText(pdfText(labelFor(m)).slice(0, 45), {
        x,
        y: y - cellH - 10,
        size: 7,
        font,
        color: rgb(0.3, 0.3, 0.3),
      });
      photoCount += 1;
      col += 1;
      if (col === cols) {
        col = 0;
        y -= cellH + 22;
      }
    }
    if (col !== 0) y -= cellH + 22;
  };

  await drawPhotos(linked, "PHOTOS DES POINTS CONTROLES");
  await drawPhotos(others, "AUTRES PHOTOS DU TOUR");

  pdf.setTitle(`Tour véhicule ${args.plate} — ${args.inspectionId}`);
  pdf.setSubject(`Compte-rendu du tour ${args.inspectionId}`);
  const base64 = await pdf.saveAsBase64();
  assertUsablePdf(base64);
  return { base64, photoCount };
}
