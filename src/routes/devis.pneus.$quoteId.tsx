/** Réouverture et réimpression d'un devis pneus archivé. */
import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Loader2, Printer } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { AppShell } from "@/components/AppShell";
import { TireQuoteSheet } from "@/components/TireQuoteSheet";
import { useSite } from "@/lib/site-context";
import { buildTireQuotePdf, openPdfBlob } from "@/lib/tire-quote-pdf";
import { fetchTireQuote, type TireQuoteRow } from "@/lib/tire-quotes";
import { marginAdjustmentLabel } from "@/lib/tires";
import type { Site } from "@/lib/sites";

export const Route = createFileRoute("/devis/pneus/$quoteId")({
  head: () => ({
    meta: [
      { title: "Devis pneus archivé — DDA Connect" },
      { name: "description", content: "Consultation et réimpression d'un devis pneumatique déjà établi." },
      { property: "og:title", content: "Devis pneus archivé — DDA Connect" },
      { property: "og:description", content: "Devis pneumatique archivé, prêt à réimprimer." },
      { property: "og:type", content: "article" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: QuoteDetail,
});

function QuoteDetail() {
  const { quoteId } = Route.useParams();
  const { sites, site: activeSite } = useSite();
  const q = useQuery({ queryKey: ["tire-quote", quoteId], queryFn: () => fetchTireQuote(quoteId) });
  const row = q.data ?? null;
  const site = row?.site_id ? (sites.find((s) => s.id === row.site_id) ?? activeSite) : activeSite;
  const [printing, setPrinting] = useState(false);

  async function print() {
    if (!row) return;
    setPrinting(true);
    try {
      const blob = await buildTireQuotePdf(headerOf(row, site ?? null), row.offers ?? []);
      openPdfBlob(blob, `devis-pneus-${row.size.replace(/\W+/g, "-")}.pdf`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Impression impossible");
    } finally {
      setPrinting(false);
    }
  }

  return (
    <AppShell
      title="Devis pneus"
      subtitle={row?.size ?? ""}
      back={{ to: "/devis/pneus/historique" }}
      right={
        row ? (
          <button
            type="button"
            onClick={() => void print()}
            aria-label="Imprimer le devis"
            className="rounded-lg border border-border p-2 text-muted-foreground print:hidden"
          >
            <Printer className="h-4 w-4" />
          </button>
        ) : null
      }
    >
      {q.isLoading ? <p className="text-sm text-muted-foreground">Chargement…</p> : null}
      {!q.isLoading && !row ? <p className="text-sm text-muted-foreground">Devis introuvable.</p> : null}
      {row ? (
        <div className="space-y-4">
          <p className="text-xs font-bold uppercase text-muted-foreground print:hidden">
            {marginAdjustmentLabel(Number(row.margin_adjustment_pct ?? 0))}
          </p>
          <TireQuoteSheet header={headerOf(row, site ?? null)} offers={row.offers ?? []} />
          <button
            type="button"
            disabled={printing}
            onClick={() => void print()}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-brand px-4 py-4 text-sm font-extrabold uppercase text-brand-foreground disabled:opacity-50 print:hidden"
          >
            {printing ? <Loader2 className="h-5 w-5 animate-spin" /> : <Printer className="h-5 w-5" />}
            Imprimer le devis
          </button>
        </div>
      ) : null}
    </AppShell>
  );
}

function headerOf(row: TireQuoteRow, site: Site | null) {
  return {
    site,
    siteLabel: row.site_label ?? "—",
    createdAt: row.created_at,
    userName: row.user_name,
    size: row.size,
    quantity: row.quantity,
    requestedBrand: row.requested_brand,
    customerName: row.customer_name,
    plate: row.plate,
    vehicleLabel: row.vehicle_label,
    loadIndex: row.load_index,
    speedIndex: row.speed_index,
  };
}
