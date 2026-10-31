/**
 * Fiche devis pneus imprimable. Aucun calcul ici : les offres affichées sont
 * exactement celles produites par le moteur de chiffrage existant.
 */
import type { SevenOffer } from "@/lib/tires";
import { MOUNT_LABEL, districashPortalLink, supplierProductLink } from "@/lib/tires";
import { siteHeader, type Site } from "@/lib/sites";
import { useState } from "react";
import { TireOrderDialog } from "@/components/TireOrderDialog";
import { canOrderOffer } from "@/lib/tire-supplier-order";


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
  quoteId = null,
}: {
  header: TireQuoteHeader;
  offers: SevenOffer[];
  internal?: boolean;
  /** Devis enregistré source (traçabilité de la commande interne). */
  quoteId?: string | null;
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
            {internal && o.available && o.title.startsWith("Top prix") ? (
              <div data-internal-only className="mt-1 flex flex-wrap gap-x-3 text-xs print:hidden">
                <span className="font-bold">Fournisseur : {supplierLabel(o.supplier)}</span>
                <span>Achat HT comparé : {euro(o.unitSourceHt)}</span>
                <span className="text-muted-foreground">{o.availability ? `Dispo : ${o.availability}` : "Disponibilité non communiquée"}</span>
                {/3PMSF/.test(o.compatibilityMessage ?? "") ? (
                  <span className="basis-full font-bold text-destructive">{o.compatibilityMessage}</span>
                ) : null}
              </div>
            ) : null}
            {internal && o.available ? <SupplierLink offer={o} order={{ size: header.size, plate: header.plate, quoteId }} /> : null}
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

function supplierLabel(key: string | null): string {
  const k = (key ?? "").toLowerCase();
  if (k.startsWith("centralepneus")) return "CentralePneus";
  if (k.startsWith("districash")) return "Districash";
  if (k.startsWith("catalogue")) return "Catalogue local";
  return key || "Catalogue local";
}

/**
 * Lien interne vers la fiche fournisseur réellement consultée. La référence
 * fournisseur (`supplierRef`) reste une donnée interne de traçabilité : elle
 * n'est jamais affichée ni copiable dans l'interface.
 */
function SupplierLink({ offer, order }: { offer: SevenOffer; order?: { size: string; plate: string | null; quoteId: string | null } }) {
  const link = supplierProductLink(offer);
  const portal = link ? null : districashPortalLink(offer);
  const [open, setOpen] = useState(false);
  return (
    <div data-internal-only className="mt-1 flex items-center justify-end gap-3 text-[11px] print:hidden">
      {order && canOrderOffer(offer) ? (
        <button type="button" onClick={() => setOpen(true)} className="rounded-md border border-border px-2 py-0.5 font-bold hover:bg-secondary">
          Commander chez DC
        </button>
      ) : null}
      {open && order ? <TireOrderDialog offer={offer} size={order.size} quoteId={order.quoteId} defaultPlate={order.plate} onClose={() => setOpen(false)} /> : null}
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
