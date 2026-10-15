/**
 * Fiche devis pneus imprimable. Aucun calcul ici : les offres affichées sont
 * exactement celles produites par le moteur de chiffrage existant.
 */
import type { SevenOffer } from "@/lib/tires";
import { MOUNT_LABEL, districashPortalLink, supplierProductLink } from "@/lib/tires";
import { siteHeader, type Site } from "@/lib/sites";


export type TireQuoteHeader = {
  site: Site | null;
  siteLabel: string;
  createdAt: string;
  userName: string | null;
  size: string;
  quantity: number;
  requestedBrand: string | null;
  customerName: string | null;
  plate: string | null;
  vehicleLabel: string | null;
  loadIndex: string | null;
  speedIndex: string | null;
};

function euro(v: number | null | undefined): string {
  if (v == null) return "—";
  return `${Number(v).toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;
}

/**
 * `internal` : affiche, à l'écran seulement, le lien fournisseur de chaque offre.
 * Ce bloc est masqué à l'impression et n'existe jamais dans les documents client.
 */
export function TireQuoteSheet({
  header,
  offers,
  internal = false,
}: {
  header: TireQuoteHeader;
  offers: SevenOffer[];
  internal?: boolean;
}) {
  const h = siteHeader(header.site);
  const date = new Date(header.createdAt).toLocaleDateString("fr-FR", {
    day: "2-digit",
    month: "long",
    year: "numeric",
  });

  return (
    <section className="card-surface space-y-4 p-4 print:border-0 print:p-0 print:shadow-none">
      <header className="flex items-start justify-between gap-3 border-b border-border pb-3">
        <div>
          <div className="text-base font-extrabold uppercase tracking-wide">
            {header.site ? h.title : header.siteLabel}
          </div>
          {h.lines.map((l) => (
            <div key={l} className="text-xs text-muted-foreground">
              {l}
            </div>
          ))}
        </div>
        <div className="text-right text-xs text-muted-foreground">
          <div className="text-sm font-bold uppercase text-foreground">Devis pneumatiques</div>
          <div>{date}</div>
          {header.userName ? <div>{header.userName}</div> : null}
        </div>
      </header>

      <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
        <div>
          <dt className="text-xs uppercase text-muted-foreground">Dimension</dt>
          <dd className="font-bold">
            {header.size}
            {header.loadIndex || header.speedIndex
              ? ` ${header.loadIndex ?? ""}${header.speedIndex ?? ""}`
              : ""}
          </dd>
        </div>
        <div>
          <dt className="text-xs uppercase text-muted-foreground">Quantité</dt>
          <dd className="font-bold">{header.quantity} pneu{header.quantity > 1 ? "s" : ""}</dd>
        </div>
        {header.customerName ? (
          <div>
            <dt className="text-xs uppercase text-muted-foreground">Client</dt>
            <dd className="font-bold">{header.customerName}</dd>
          </div>
        ) : null}
        {header.plate || header.vehicleLabel ? (
          <div>
            <dt className="text-xs uppercase text-muted-foreground">Véhicule</dt>
            <dd className="font-bold">{[header.vehicleLabel, header.plate].filter(Boolean).join(" · ")}</dd>
          </div>
        ) : null}
        {header.requestedBrand ? (
          <div>
            <dt className="text-xs uppercase text-muted-foreground">Marque demandée</dt>
            <dd className="font-bold">{header.requestedBrand}</dd>
          </div>
        ) : null}
      </dl>

      <div className="space-y-2">
        {offers.map((o) => (
          <div
            key={o.slot}
            className="rounded-lg border border-border p-3 print:break-inside-avoid"
          >
            <div className="flex items-baseline justify-between gap-2">
              <div className="text-sm font-extrabold uppercase">{o.title}</div>
              <div className="text-base font-extrabold">{o.available ? euro(o.totalTtc) : "—"}</div>
            </div>
            {o.available ? (
              <div className="text-xs text-muted-foreground">
                {[o.brand, o.model, o.size, [o.loadIndex, o.speedIndex].filter(Boolean).join("")]
                  .filter(Boolean)
                  .join(" · ")}
              </div>
            ) : (
              <div className="text-xs text-muted-foreground">{o.unavailableReason}</div>
            )}
            {o.available ? (
              <div className="text-xs text-muted-foreground">
                {o.quantity} pneu{o.quantity > 1 ? "s" : ""} {euro(o.tiresTtc)}
                {o.mountTtc != null ? ` · ${MOUNT_LABEL} ${euro(o.mountTtc)}` : " · montage non paramétré"}
              </div>
            ) : null}
            {internal && o.available ? <SupplierLink offer={o} /> : null}
          </div>
        ))}
      </div>

      <p className="text-[10px] leading-snug text-muted-foreground">
        Prix TTC indicatifs, sous réserve de disponibilité au moment de la commande. Montage, équilibrage et
        prestations associées selon le forfait indiqué. Devis valable 15 jours.
      </p>
    </section>
  );
}

/**
 * Lien interne vers la fiche fournisseur réellement consultée. La référence
 * fournisseur (`supplierRef`) reste une donnée interne de traçabilité : elle
 * n'est jamais affichée ni copiable dans l'interface.
 */
function SupplierLink({ offer }: { offer: SevenOffer }) {
  const link = supplierProductLink(offer);
  const portal = link ? null : districashPortalLink(offer);
  return (
    <div data-internal-only className="mt-1 text-right text-[11px] print:hidden">
      {portal ? (
        <a
          href={portal.url}
          target="_blank"
          rel="noopener noreferrer"
          className="font-semibold text-muted-foreground underline underline-offset-2 hover:text-foreground"
        >
          {portal.label} ↗
        </a>
      ) : link ? (
        <a
          href={link.url}
          target="_blank"
          rel="noopener noreferrer"
          className="font-semibold text-muted-foreground underline underline-offset-2 hover:text-foreground"
        >
          Commander chez le fournisseur ({link.label}) ↗
        </a>
      ) : (
        <span className="text-muted-foreground/70">Lien fournisseur indisponible</span>
      )}
    </div>
  );
}
