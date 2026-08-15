import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Copy, ExternalLink } from "lucide-react";
import { toast } from "sonner";

import { AppShell } from "@/components/AppShell";
import { formatPlate } from "@/lib/plate";
import { fetchReport } from "@/lib/report";
import { ReportBody, Summary } from "@/components/ReportView";

export const Route = createFileRoute("/tour/$tourId/rapport")({
  head: () => ({
    meta: [
      { title: "Rapport de tour véhicule — DDA Connect" },
      {
        name: "description",
        content: "Rapport atelier complet : contrôles, statuts, mesures, commentaires et photos.",
      },
      { property: "og:title", content: "Rapport de tour véhicule — DDA Connect" },
      { property: "og:description", content: "Rapport atelier complet du tour véhicule." },
    ],
  }),
  component: ReportPage,
});

function ReportPage() {
  const { tourId } = Route.useParams();
  const [detailed, setDetailed] = useState(true);
  const report = useQuery({ queryKey: ["report", tourId], queryFn: () => fetchReport({ id: tourId }) });

  if (report.isLoading || !report.data) {
    return (
      <AppShell title="Rapport">
        <p className="text-sm text-muted-foreground">Chargement…</p>
      </AppShell>
    );
  }

  const d = report.data;
  const shareUrl =
    typeof window !== "undefined"
      ? `${window.location.origin}/partage/${d.inspection.share_token}`
      : "";

  return (
    <AppShell
      title="Rapport atelier"
      subtitle={formatPlate(d.vehicle?.plate ?? "")}
      back={d.order ? { to: "/or/$orId", params: { orId: d.order.id } } : { to: "/" }}
    >
      <div className="space-y-4">
        <Summary d={d} />

        <div className="grid grid-cols-2 gap-2">
          <a
            href={shareUrl}
            target="_blank"
            rel="noreferrer"
            className="flex items-center justify-center gap-2 rounded-lg border-2 border-border bg-card px-3 py-3 text-sm font-bold uppercase"
          >
            <ExternalLink className="h-4 w-4" /> Aperçu client
          </a>
          <button
            onClick={() => {
              void navigator.clipboard.writeText(shareUrl);
              toast.success("Lien copié");
            }}
            className="flex items-center justify-center gap-2 rounded-lg bg-brand px-3 py-3 text-sm font-bold uppercase text-brand-foreground"
          >
            <Copy className="h-4 w-4" /> Copier le lien
          </button>
        </div>

        <div className="flex gap-2">
          <button
            onClick={() => setDetailed(false)}
            className={`flex-1 rounded-lg border-2 px-3 py-2 text-sm font-bold uppercase ${!detailed ? "border-brand bg-brand/20" : "border-border bg-card"}`}
          >
            Synthèse
          </button>
          <button
            onClick={() => setDetailed(true)}
            className={`flex-1 rounded-lg border-2 px-3 py-2 text-sm font-bold uppercase ${detailed ? "border-brand bg-brand/20" : "border-border bg-card"}`}
          >
            Détail
          </button>
        </div>

        <ReportBody d={d} detailed={detailed} clientView={false} />
      </div>
    </AppShell>
  );
}

