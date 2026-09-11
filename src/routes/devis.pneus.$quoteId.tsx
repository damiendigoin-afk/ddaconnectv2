/** Réouverture et réimpression d'un devis pneus archivé. */
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Printer } from "lucide-react";

import { AppShell } from "@/components/AppShell";
import { TireQuoteSheet } from "@/components/TireQuoteSheet";
import { useSite } from "@/lib/site-context";
import { fetchTireQuote } from "@/lib/tire-quotes";

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

  return (
    <AppShell
      title="Devis pneus"
      subtitle={row?.size ?? ""}
      back={{ to: "/devis/pneus/historique" }}
      right={
        row ? (
          <Link
            to="/devis/pneus/$quoteId/pdf"
            params={{ quoteId }}
            aria-label="Imprimer le devis"
            className="rounded-lg border border-border p-2 text-muted-foreground print:hidden"
          >
            <Printer className="h-4 w-4" />
          </Link>
        ) : null
      }
    >

      {q.isLoading ? <p className="text-sm text-muted-foreground">Chargement…</p> : null}
      {!q.isLoading && !row ? <p className="text-sm text-muted-foreground">Devis introuvable.</p> : null}
      {row ? (
        <div className="space-y-4">
          <TireQuoteSheet
            header={{
              site: site ?? null,
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
            }}
            offers={row.offers ?? []}
          />
          <Link
            to="/devis/pneus/$quoteId/pdf"
            params={{ quoteId }}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-brand px-4 py-4 text-sm font-extrabold uppercase text-brand-foreground print:hidden"
          >
            <Printer className="h-5 w-5" /> Imprimer le devis
          </Link>

        </div>
      ) : null}
    </AppShell>
  );
}
