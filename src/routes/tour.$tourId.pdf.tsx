import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Printer } from "lucide-react";

import { fetchReport, type ReportMedia } from "@/lib/report";
import { ctSummaryLabel, formatCtDate, POLLUTION_PREFIX, reportCtDates } from "@/lib/ct";
import { formatPlate } from "@/lib/plate";
import { useSite } from "@/lib/site-context";
import { GROUP_LABEL, siteHeader } from "@/lib/sites";
import { mediaUrl } from "@/lib/photo";
import ddaRenaultLogo from "@/assets/dda-renault-logo.jpeg.asset.json";

export const Route = createFileRoute("/tour/$tourId/pdf")({
  head: () => ({
    meta: [
      { title: "Rapport PDF du tour véhicule — DDA Connect" },
      { name: "description", content: "Rapport A4 imprimable du tour véhicule : contrôles, observations et photos." },
      { property: "og:title", content: "Rapport PDF du tour véhicule — DDA Connect" },
      { property: "og:description", content: "Version imprimable et archivable du tour véhicule." },
      { property: "og:type", content: "article" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: PdfPage,
});

const STATUS_FR: Record<string, string> = {
  ok: "OK",
  watch: "À surveiller",
  defect: "Défaut",
  unset: "Non renseigné",
};

/** Charte D.D.A. : noir + jaune, couleurs réservées aux statuts. */
const DDA_YELLOW = "#F2C200";
const STATUS_COLOR: Record<string, string> = {
  ok: "#15803d",
  watch: "#b45309",
  defect: "#b91c1c",
  unset: "#525252",
};


/** Image de rapport : URL signée (bucket privé) + gestion d'échec non bloquante. */
function PdfPhoto({
  media,
  caption,
  onSettled,
}: {
  media: ReportMedia;
  caption?: string;
  onSettled: () => void;
}) {
  const [url, setUrl] = useState("");
  const [failed, setFailed] = useState(false);
  const settled = useRef(false);

  const settle = useCallback(() => {
    if (settled.current) return;
    settled.current = true;
    onSettled();
  }, [onSettled]);

  useEffect(() => {
    let active = true;
    // La miniature suffit pour l'impression et allège fortement le PDF.
    void mediaUrl(media.thumb_path ?? media.storage_path)
      .then((u) => {
        if (!active) return;
        if (u) setUrl(u);
        else {
          setFailed(true);
          settle();
        }
      })
      .catch(() => {
        if (!active) return;
        setFailed(true);
        settle();
      });
    return () => {
      active = false;
    };
  }, [media.storage_path, media.thumb_path, settle]);

  return (
    <figure className="break-inside-avoid">
      {failed ? (
        <div className="flex h-40 w-full items-center justify-center border border-neutral-400 text-[8pt] text-neutral-500">
          Photo indisponible
        </div>
      ) : (
        <img
          src={url || undefined}
          alt={caption ? `Photo — ${caption}` : "Photo du tour véhicule"}
          className="h-40 w-full border border-neutral-400 object-cover"
          onLoad={settle}
          onError={() => {
            console.error("[pdf] photo illisible", media.storage_path);
            setFailed(true);
            settle();
          }}
        />
      )}
      {caption ? <figcaption className="text-[8pt] leading-tight">{caption}</figcaption> : null}
    </figure>
  );
}

function PdfPage() {
  const { tourId } = Route.useParams();
  const { site } = useSite();
  const report = useQuery({ queryKey: ["report", tourId], queryFn: () => fetchReport({ id: tourId }) });

  const media = useMemo(() => report.data?.media ?? [], [report.data]);
  const totalPhotos = media.length;
  const [settledCount, setSettledCount] = useState(0);
  const onSettled = useCallback(() => setSettledCount((n) => n + 1), []);

  // On n'imprime qu'une fois toutes les images chargées (ou après un délai de
  // sécurité) : sinon le PDF sort avec des cadres vides.
  useEffect(() => {
    if (!report.data) return undefined;
    if (settledCount < totalPhotos) {
      const guard = setTimeout(() => window.print(), 15000);
      return () => clearTimeout(guard);
    }
    const t = setTimeout(() => window.print(), 400);
    return () => clearTimeout(t);
  }, [report.data, settledCount, totalPhotos]);

  if (!report.data) return <p className="p-6 text-sm">Préparation du rapport…</p>;

  const d = report.data;
  const head = siteHeader(site);
  const started = d.inspection.started_at ? new Date(d.inspection.started_at) : null;
  const finished = d.inspection.finished_at
    ? new Date(d.inspection.finished_at)
    : d.inspection.completed_at
      ? new Date(d.inspection.completed_at)
      : null;
  const dur = d.inspection.duration_seconds;
  // Toutes les photos du tour sont reprises : rattachées à leur point ou
  // observation quand le lien existe, sinon regroupées en fin de rapport.
  const linkedMedia = media.filter(
    (m) =>
      (m.inspection_point_id && d.points.some((p) => p.id === m.inspection_point_id)) ||
      (m.observation_id && d.observations.some((o) => o.id === m.observation_id)),
  );
  const otherMedia = media.filter((m) => !linkedMedia.includes(m));
  const captionFor = (m: ReportMedia) => {
    const point = d.points.find((p) => p.id === m.inspection_point_id);
    if (point) return `${point.zone_label} — ${point.point_label}`;
    const obs = d.observations.find((o) => o.id === m.observation_id);
    if (obs) return `${obs.category} — ${obs.element}`;
    return m.label ?? "";
  };
  const ctDates = reportCtDates(d);
  const clientName = [d.order?.client?.first_name, d.order?.client?.last_name].filter(Boolean).join(" ");

  // Seuls les contrôles réellement effectués sont imprimés : aucune ligne
  // « non contrôlé » ne doit apparaître dans le document client.
  const donePoints = d.points.filter(
    (p) =>
      p.status === "ok" ||
      p.status === "watch" ||
      p.status === "defect" ||
      Boolean(p.comment) ||
      p.measure_value != null,
  );

  // Regroupement par zone, dans l'ordre réel des points enregistrés : aucune
  // case n'est fabriquée, seuls les contrôles existants du tour sont restitués.
  const zones: { label: string; points: typeof d.points }[] = [];
  for (const p of donePoints) {
    const label = p.zone_label || "Contrôles";
    const last = zones[zones.length - 1];
    if (last && last.label === label) last.points.push(p);
    else zones.push({ label, points: [p] });
  }
  const counts = { ok: 0, watch: 0, defect: 0, unset: 0 };
  for (const p of donePoints) {
    const key = (p.status === "ok" || p.status === "watch" || p.status === "defect"
      ? p.status
      : "unset") as keyof typeof counts;
    counts[key] += 1;
  }


  const cell = "border border-neutral-300 px-2 py-[3px] align-top";

  return (
    <div className="mx-auto max-w-[210mm] bg-white p-8 text-[11pt] text-black print:p-0">
      <button
        onClick={() => window.print()}
        className="mb-4 flex items-center gap-2 rounded-lg border-2 border-black px-3 py-2 text-xs font-bold uppercase print:hidden"
      >
        <Printer className="h-4 w-4" /> Imprimer / Enregistrer en PDF
      </button>

      <header className="border-b-4 border-black pb-2">
        <div className="flex items-start justify-between gap-4">
          <div>
            <img
              src={ddaRenaultLogo.url}
              alt="D.D.A. Renault — Saint-Cyprien et Lalinde"
              className="mb-2 h-16 w-auto object-contain"
            />
            <div className="text-base font-extrabold uppercase">{site ? head.title : GROUP_LABEL}</div>
            {head.lines.map((l) => (
              <div key={l} className="text-[9pt]">
                {l}
              </div>
            ))}
          </div>
          <div className="text-right">
            <div className="text-lg font-extrabold uppercase leading-tight">Compte-rendu tour de véhicule</div>
            <div className="text-[9pt]">
              {finished ? finished.toLocaleDateString("fr-FR") : ""}
              {finished ? ` · ${finished.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}` : ""}
            </div>
            {d.order?.or_number ? <div className="text-[9pt]">OR WinMotor {d.order.or_number}</div> : null}
          </div>
        </div>
        {/* Filet dynamique discret, charte D.D.A. (noir + jaune). */}
        <div className="mt-2 h-[3px] w-full" style={{ background: DDA_YELLOW }} />
      </header>

      <section className="mt-4 grid grid-cols-2 gap-4 text-[10pt]">
        <div>
          <div className="font-bold uppercase">Client</div>
          <div>{clientName || "—"}</div>
          <div>{d.order?.client?.email ?? ""}</div>
          <div className="mt-1 font-bold uppercase">Opérateur / site</div>
          <div>
            {[d.inspection.completed_by_name ?? "—", site ? head.title : GROUP_LABEL].filter(Boolean).join(" · ")}
          </div>
        </div>
        <div>
          <div className="font-bold uppercase">Véhicule</div>
          <div className="text-lg font-extrabold">{formatPlate(d.vehicle?.plate ?? "")}</div>
          <div>{[d.vehicle?.brand, d.vehicle?.model].filter(Boolean).join(" ")}</div>
          <div>
            {d.inspection.mileage ? `${d.inspection.mileage.toLocaleString("fr-FR")} km · ` : ""}
            {ctSummaryLabel(ctDates.ct)}
          </div>
          {formatCtDate(ctDates.pollution) ? (
            <div>{`${POLLUTION_PREFIX} ${formatCtDate(ctDates.pollution)}.`}</div>
          ) : null}
        </div>
      </section>

      <section className="mt-3 border-y border-black py-2 text-[9pt]">
        {[
          started ? `Début : ${started.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}` : "",
          finished ? `Fin : ${finished.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}` : "",
          dur != null ? `Durée : ${Math.floor(dur / 60)} min` : "",
          `${donePoints.length} contrôle(s) · ${totalPhotos} photo(s)`,
        ]
          .filter(Boolean)
          .join(" · ")}
      </section>

      <section className="mt-4 grid grid-cols-3 gap-2 text-center text-[9pt]">
        {(
          [
            ["OK", counts.ok, "#15803d"],
            ["À surveiller", counts.watch, "#b45309"],
            ["Défaut", counts.defect, "#b91c1c"],
          ] as const
        ).map(([label, value, color]) => (
          <div key={label} className="border border-neutral-400 py-1">
            <div className="text-lg font-extrabold" style={{ color }}>
              {value}
            </div>
            <div className="uppercase">{label}</div>
          </div>
        ))}
      </section>

      {zones.map((z) => (
        <section key={z.label} className="mt-4 break-inside-avoid">
          <h2 className="mb-1 border-l-4 pl-2 text-sm font-extrabold uppercase" style={{ borderColor: DDA_YELLOW }}>
            {z.label}
          </h2>
          <table className="w-full border-collapse text-[9.5pt]">
            <thead>
              <tr className="text-left">
                <th className={`${cell} w-[42%] bg-neutral-100`}>Contrôle</th>
                <th className={`${cell} w-[18%] bg-neutral-100`}>État</th>
                <th className={`${cell} bg-neutral-100`}>Commentaire opérateur</th>
              </tr>
            </thead>
            <tbody>
              {z.points.map((p) => (
                <tr key={p.id}>
                  <td className={cell}>{p.point_label}</td>
                  <td className={`${cell} font-bold`} style={{ color: STATUS_COLOR[p.status] ?? "#525252" }}>
                    {STATUS_FR[p.status] ?? p.status}
                  </td>
                  <td className={cell}>
                    {[p.measure_value ? `${p.measure_value} ${p.measure_unit ?? ""}`.trim() : "", p.comment ?? ""]
                      .filter(Boolean)
                      .join(" — ")}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ))}

      {d.observations.length ? (
        <section className="mt-4 break-inside-avoid">
          <h2 className="mb-1 border-l-4 pl-2 text-sm font-extrabold uppercase" style={{ borderColor: DDA_YELLOW }}>
            Observations complémentaires
          </h2>
          <table className="w-full border-collapse text-[9.5pt]">
            <tbody>
              {d.observations.map((o) => (
                <tr key={o.id}>
                  <td className={`${cell} w-[42%]`}>{`${o.category} — ${o.element}`}</td>
                  <td className={`${cell} w-[18%] font-bold`} style={{ color: STATUS_COLOR[o.status] ?? "#525252" }}>
                    {STATUS_FR[o.status] ?? o.status}
                  </td>
                  <td className={cell}>
                    {[o.measure_value ? `${o.measure_value} ${o.measure_unit ?? ""}`.trim() : "", o.comment ?? ""]
                      .filter(Boolean)
                      .join(" — ")}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ) : null}

      {linkedMedia.length ? (
        <section className="mt-4 break-before-page">
          <h2 className="mb-2 text-sm font-extrabold uppercase">Photos des points contrôlés</h2>
          <div className="grid grid-cols-3 gap-2">
            {linkedMedia.map((m) => (
              <PdfPhoto key={m.id} media={m} caption={captionFor(m)} onSettled={onSettled} />
            ))}
          </div>
        </section>
      ) : null}

      {otherMedia.length ? (
        <section className="mt-4">
          <h2 className="mb-2 text-sm font-extrabold uppercase">Autres photos du tour</h2>
          <div className="grid grid-cols-3 gap-2">
            {otherMedia.map((m) => (
              <PdfPhoto key={m.id} media={m} caption={captionFor(m)} onSettled={onSettled} />
            ))}
          </div>
        </section>
      ) : null}

      <footer className="mt-6 border-t-2 border-black pt-2 text-[8pt]">
        <div>
          Légende : OK = conforme · À surveiller = à prévoir · Défaut = intervention nécessaire · Non renseigné =
          contrôle non réalisé.
        </div>
        <div className="mt-1 flex justify-between">
          <span>
            Opérateur : {d.inspection.completed_by_name ?? "—"} · {totalPhotos} photo(s)
          </span>
          <span>Document généré par DDA Connect — {site ? head.title : GROUP_LABEL}</span>
        </div>
      </footer>
    </div>
  );
}

