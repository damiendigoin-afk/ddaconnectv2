/**
 * Document client A4 du devis pneus — même principe que le rapport PDF du tour
 * véhicule : page A4 stylée pour l'impression / « Enregistrer en PDF ».
 * Aucun calcul ici : les offres affichées sont celles produites par le moteur
 * pneus partagé.
 */
import type { SevenOffer } from "@/lib/tires";
import { MOUNT_LABEL } from "@/lib/tires";
import { GROUP_LABEL, siteHeader, type Site } from "@/lib/sites";
import ddaRenaultLogo from "@/assets/dda-renault-logo.jpeg.asset.json";

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

export function TireQuoteDocument({
  header,
  offers,
}: {
  header: TireQuoteHeader;
  offers: SevenOffer[];
}) {
  const h = siteHeader(header.site);
  const date = new Date(header.createdAt).toLocaleDateString("fr-FR", {
    day: "2-digit",
    month: "long",
    year: "numeric",
  });
  const dimension = `${header.size}${
    header.loadIndex || header.speedIndex ? ` ${header.loadIndex ?? ""}${header.speedIndex ?? ""}` : ""
  }`;
  const cell = "border border-neutral-300 px-2 py-[3px] align-top";

  return (
    <div className="mx-auto max-w-[210mm] bg-white p-8 text-[10pt] text-black print:p-0">
      <header className="flex items-start justify-between gap-4 border-b-4 border-black pb-2">
        <div>
          <img
            src={ddaRenaultLogo.url}
            alt="D.D.A. Renault — Saint-Cyprien et Lalinde"
            className="mb-2 h-14 w-auto object-contain"
          />
          <div className="text-sm font-extrabold uppercase">
            {header.site ? h.title : header.siteLabel || GROUP_LABEL}
          </div>
          {h.lines.map((l) => (
            <div key={l} className="text-[8.5pt] leading-tight">
              {l}
            </div>
          ))}
        </div>
        <div className="text-right">
          <div className="text-base font-extrabold uppercase leading-tight">Devis pneumatiques</div>
          <div className="text-[9pt]">{date}</div>
          {header.userName ? <div className="text-[9pt]">{header.userName}</div> : null}
        </div>
      </header>

      <table className="mt-3 w-full border-collapse text-[9pt]">
        <tbody>
          <tr>
            <th className={`${cell} w-28 bg-neutral-100 text-left uppercase`}>Dimension</th>
            <td className={`${cell} font-bold`}>{dimension}</td>
            <th className={`${cell} w-28 bg-neutral-100 text-left uppercase`}>Quantité</th>
            <td className={`${cell} font-bold`}>
              {header.quantity} pneu{header.quantity > 1 ? "s" : ""}
            </td>
          </tr>
          <tr>
            <th className={`${cell} bg-neutral-100 text-left uppercase`}>Client</th>
            <td className={cell}>{header.customerName || "—"}</td>
            <th className={`${cell} bg-neutral-100 text-left uppercase`}>Véhicule</th>
            <td className={cell}>
              {[header.vehicleLabel, header.plate].filter(Boolean).join(" · ") || "—"}
            </td>
          </tr>
          {header.requestedBrand ? (
            <tr>
              <th className={`${cell} bg-neutral-100 text-left uppercase`}>Marque demandée</th>
              <td className={cell} colSpan={3}>
                {header.requestedBrand}
              </td>
            </tr>
          ) : null}
        </tbody>
      </table>

      <table className="mt-3 w-full border-collapse text-[9pt]">
        <thead>
          <tr className="bg-neutral-100">
            <th className={`${cell} text-left uppercase`}>Proposition</th>
            <th className={`${cell} text-left uppercase`}>Marque / modèle</th>
            <th className={`${cell} text-left uppercase`}>Dimension</th>
            <th className={`${cell} w-24 text-right uppercase`}>Prix TTC</th>
          </tr>
        </thead>
        <tbody>
          {offers.map((o) => (
            <tr key={o.slot} className="break-inside-avoid">
              <td className={`${cell} font-bold`}>{o.title}</td>
              <td className={cell}>
                {o.available
                  ? [o.brand, o.model].filter(Boolean).join(" ")
                  : o.unavailableReason || "Non disponible"}
              </td>
              <td className={cell}>
                {o.available
                  ? [o.size, [o.loadIndex, o.speedIndex].filter(Boolean).join("")]
                      .filter(Boolean)
                      .join(" ")
                  : "—"}
              </td>
              <td className={`${cell} text-right font-extrabold`}>
                {o.available ? euro(o.totalTtc) : "—"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <p className="mt-2 text-[9pt] font-bold">
        Prix TTC pour {header.quantity} pneu{header.quantity > 1 ? "s" : ""} — {MOUNT_LABEL} compris.
      </p>
      <p className="mt-1 text-[8pt] leading-snug">
        Prix indicatifs sous réserve de disponibilité au moment de la commande. Devis valable 15
        jours. Aucune autre prestation n'est incluse dans ces montants.
      </p>
    </div>
  );
}
