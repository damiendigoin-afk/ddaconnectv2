import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useEffect } from "react";
import { Printer } from "lucide-react";

import { fetchReport } from "@/lib/report";
import { formatPlate } from "@/lib/plate";
import { useSite } from "@/lib/site-context";
import { GROUP_LABEL, siteHeader } from "@/lib/sites";
import { supabase } from "@/integrations/supabase/client";

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

function publicUrl(path: string) {
  return supabase.storage.from("dda-media").getPublicUrl(path).data.publicUrl;
}

function PdfPage() {
  const { tourId } = Route.useParams();
  const { site } = useSite();
  const report = useQuery({ queryKey: ["report", tourId], queryFn: () => fetchReport({ id: tourId }) });

  useEffect(() => {
    if (report.data) {
      const t = setTimeout(() => window.print(), 600);
      return () => clearTimeout(t);
    }
    return undefined;
  }, [report.data]);

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
  const alerts = d.points.filter((p) => p.status === "watch" || p.status === "defect");
  const alertMedia = d.media.filter(
    (m) =>
      (m.inspection_point_id && alerts.some((p) => p.id === m.inspection_point_id)) ||
      (m.observation_id && d.observations.some((o) => o.id === m.observation_id)),
  );
  const clientName = [d.order?.client?.first_name, d.order?.client?.last_name].filter(Boolean).join(" ");

  return (
    <div className="mx-auto max-w-[210mm] bg-white p-8 text-[11pt] text-black print:p-0">
      <button
        onClick={() => window.print()}
        className="mb-4 flex items-center gap-2 rounded-lg border-2 border-black px-3 py-2 text-xs font-bold uppercase print:hidden"
      >
        <Printer className="h-4 w-4" /> Imprimer / Enregistrer en PDF
      </button>

      <header className="flex items-start justify-between gap-4 border-b-2 border-black pb-3">
        <div>
          {site?.logo_url ? (
            <img src={site.logo_url} alt={head.title} className="mb-2 h-12 object-contain" />
          ) : null}
          <div className="text-base font-extrabold uppercase">{site ? head.title : GROUP_LABEL}</div>
          {head.lines.map((l) => (
            <div key={l} className="text-[9pt]">
              {l}
            </div>
          ))}
        </div>
        <div className="text-right">
          <div className="text-lg font-extrabold uppercase">Rapport de tour véhicule</div>
          <div className="text-[9pt]">
            {finished ? finished.toLocaleDateString("fr-FR") : ""}
            {finished ? ` · ${finished.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}` : ""}
          </div>
          {d.order?.or_number ? <div className="text-[9pt]">OR {d.order.or_number}</div> : null}
        </div>
      </header>

      <section className="mt-4 grid grid-cols-2 gap-4 text-[10pt]">
        <div>
          <div className="font-bold uppercase">Client</div>
          <div>{clientName || "—"}</div>
          <div>{d.order?.client?.email ?? ""}</div>
        </div>
        <div>
          <div className="font-bold uppercase">Véhicule</div>
          <div className="text-lg font-extrabold">{formatPlate(d.vehicle?.plate ?? "")}</div>
          <div>{[d.vehicle?.brand, d.vehicle?.model].filter(Boolean).join(" ")}</div>
          <div>{d.inspection.mileage ? `${d.inspection.mileage.toLocaleString("fr-FR")} km` : "Kilométrage non relevé"}</div>
        </div>
      </section>

      <section className="mt-3 border-y border-black py-2 text-[9pt]">
        <span className="font-bold uppercase">Opérateur : </span>
        {d.inspection.completed_by_name ?? "—"}
        {started ? ` · Début ${started.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}` : ""}
        {finished ? ` · Fin ${finished.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}` : ""}
        {dur != null ? ` · Durée ${Math.floor(dur / 60)} min` : ""}
      </section>

      <section className="mt-4">
        <h2 className="mb-2 text-sm font-extrabold uppercase">Résumé des contrôles</h2>
        <table className="w-full border-collapse text-[9.5pt]">
          <thead>
            <tr className="bg-neutral-200 text-left">
              <th className="border border-neutral-400 px-2 py-1">Zone</th>
              <th className="border border-neutral-400 px-2 py-1">Point</th>
              <th className="border border-neutral-400 px-2 py-1">État</th>
              <th className="border border-neutral-400 px-2 py-1">Mesure / Commentaire</th>
            </tr>
          </thead>
          <tbody>
            {d.points.map((p) => (
              <tr key={p.id}>
                <td className="border border-neutral-400 px-2 py-1">{p.zone_label}</td>
                <td className="border border-neutral-400 px-2 py-1">{p.point_label}</td>
                <td className="border border-neutral-400 px-2 py-1 font-bold">{STATUS_FR[p.status] ?? p.status}</td>
                <td className="border border-neutral-400 px-2 py-1">
                  {[p.measure_value ? `${p.measure_value} ${p.measure_unit ?? ""}`.trim() : "", p.comment ?? ""]
                    .filter(Boolean)
                    .join(" — ")}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {d.observations.length ? (
        <section className="mt-4">
          <h2 className="mb-2 text-sm font-extrabold uppercase">Observations</h2>
          <ul className="list-disc pl-5 text-[10pt]">
            {d.observations.map((o) => (
              <li key={o.id}>
                <span className="font-bold">{o.element}</span> ({o.category}) — {STATUS_FR[o.status] ?? o.status}
                {o.comment ? ` — ${o.comment}` : ""}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {alertMedia.length ? (
        <section className="mt-4 break-inside-avoid">
          <h2 className="mb-2 text-sm font-extrabold uppercase">Photos des anomalies</h2>
          <div className="grid grid-cols-3 gap-2">
            {alertMedia.slice(0, 9).map((m) => (
              <img
                key={m.id}
                src={publicUrl(m.storage_path)}
                alt="Anomalie constatée sur le véhicule"
                className="h-40 w-full border border-neutral-400 object-cover"
              />
            ))}
          </div>
        </section>
      ) : null}

      <footer className="mt-6 border-t border-black pt-2 text-[8pt]">
        Document généré par DDA Connect — {site ? head.title : GROUP_LABEL}
      </footer>
    </div>
  );
}
