/** Devis pneus — document client A4 prêt à imprimer / enregistrer en PDF. */
import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useEffect } from "react";
import { Printer } from "lucide-react";

import { TireQuoteDocument } from "@/components/TireQuoteDocument";
import { useSite } from "@/lib/site-context";
import { fetchTireQuote } from "@/lib/tire-quotes";

export const Route = createFileRoute("/devis/pneus/$quoteId/pdf")({
  head: () => ({
    meta: [
      { title: "Devis pneus PDF — DDA Connect" },
      { name: "description", content: "Devis pneumatique client au format A4, prêt à imprimer ou à enregistrer en PDF." },
      { property: "og:title", content: "Devis pneus PDF — DDA Connect" },
      { property: "og:description", content: "Document client A4 du devis pneumatique." },
      { property: "og:type", content: "article" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: TireQuotePdf,
});

function TireQuotePdf() {
  const { quoteId } = Route.useParams();
  const { sites, site: activeSite } = useSite();
  const q = useQuery({ queryKey: ["tire-quote", quoteId], queryFn: () => fetchTireQuote(quoteId) });
  const row = q.data ?? null;

  useEffect(() => {
    if (!row) return undefined;
    const t = setTimeout(() => window.print(), 500);
    return () => clearTimeout(t);
  }, [row]);

  if (q.isLoading) return <p className="p-6 text-sm">Préparation du devis…</p>;
  if (!row) return <p className="p-6 text-sm">Devis introuvable.</p>;

  const site = row.site_id ? (sites.find((s) => s.id === row.site_id) ?? activeSite) : activeSite;

  return (
    <>
      <button
        onClick={() => window.print()}
        className="m-4 flex items-center gap-2 rounded-lg border-2 border-black px-3 py-2 text-xs font-bold uppercase print:hidden"
      >
        <Printer className="h-4 w-4" /> Imprimer / Enregistrer en PDF
      </button>
      <TireQuoteDocument
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
    </>
  );
}
