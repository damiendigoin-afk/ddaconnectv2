import { MediaThumb } from "@/components/PhotoManager";
import { useLightbox } from "@/components/PhotoLightbox";
import { formatPlate } from "@/lib/plate";
import {
  CONDITIONS,
  ELEMENT_SIZES,
  INTERVENTIONS,
  REG_DOC_OPTIONS,
  euro,
  totals,
  type ExpertiseData,
} from "@/lib/expertise";

function label(list: readonly { key: string; label: string }[], key: string | null | undefined) {
  return list.find((x) => x.key === key)?.label ?? "";
}

function Row({ k, v }: { k: string; v: string }) {
  if (!v) return null;
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-border/60 py-1.5 last:border-0">
      <span className="text-xs uppercase tracking-wide text-muted-foreground">{k}</span>
      <span className="text-right text-sm font-bold">{v}</span>
    </div>
  );
}

export function ExpertiseReport({ d }: { d: ExpertiseData }) {
  const { expertise: e, photos, damages } = d;
  const { total, pending } = totals(damages);
  const vehicle = [e.brand, e.model, e.version].filter(Boolean).join(" ");
  const photoOf = (id: string | null) => photos.find((p) => p.id === id);
  const lightbox = useLightbox();
  const openPhoto = (p: (typeof photos)[number]) =>
    lightbox.open([{ src: p.storage_path, thumb: p.report_path ?? p.storage_path, label: p.label }], 0);

  return (
    <div className="space-y-4">
      <section className="card-surface p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <div className="plate-badge text-xl">{formatPlate(e.plate ?? "")}</div>
            <div className="text-sm font-bold">{vehicle || "Véhicule"}</div>
          </div>
          <span className="rounded-full bg-secondary px-3 py-1 text-xs font-bold uppercase">
            Expertise
          </span>
        </div>
        <div className="mt-3">
          <Row k="VIN" v={e.vin ?? ""} />
          <Row k="1re immat." v={e.first_registration ?? ""} />
          <Row k="Énergie" v={e.energy ?? ""} />
          <Row k="Couleur" v={e.color ?? ""} />
          <Row
            k="Kilométrage"
            v={e.mileage != null ? `${e.mileage.toLocaleString("fr-FR")} km` : ""}
          />
          <Row k="Clés" v={e.keys_count ?? ""} />
          <Row k="Carte grise" v={label(REG_DOC_OPTIONS, e.registration_doc)} />
          <Row k="État extérieur" v={label(CONDITIONS, e.exterior_condition)} />
          <Row k="État intérieur" v={label(CONDITIONS, e.interior_condition)} />
          <Row k="Propriétaire" v={e.owner_name ?? ""} />
          <Row k="Date" v={new Date(e.created_at).toLocaleDateString("fr-FR")} />
        </div>
        {e.general_comment ? (
          <p className="mt-3 rounded-lg bg-secondary p-3 text-sm">{e.general_comment}</p>
        ) : null}
      </section>

      <section className="card-surface p-4">
        <h2 className="text-sm font-extrabold uppercase tracking-wide">
          Dommages constatés ({damages.length})
        </h2>
        {damages.length === 0 ? (
          <p className="mt-2 text-sm text-muted-foreground">
            Aucun dommage constaté lors de cette expertise.
          </p>
        ) : (
          <ul className="mt-3 space-y-3">
            {damages.map((dm) => {
              const p = photoOf(dm.photo_id);
              return (
                <li key={dm.id} className="rounded-xl border-2 border-border p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="text-sm font-extrabold">
                        N°{dm.damage_number} — {dm.vehicle_zone || "Zone non précisée"}
                      </div>
                      <div className="text-xs text-muted-foreground">{dm.damage_type}</div>
                    </div>
                    <div className="text-right">
                      <div className="text-sm font-extrabold text-brand">
                        {dm.cost_pending || dm.estimated_cost == null
                          ? "À chiffrer"
                          : euro(Number(dm.estimated_cost))}
                      </div>
                      <div className="text-[11px] uppercase text-muted-foreground">
                        {[label(INTERVENTIONS, dm.intervention), label(ELEMENT_SIZES, dm.element_size)]
                          .filter(Boolean)
                          .join(" · ")}
                      </div>
                    </div>
                  </div>
                  {dm.comment ? <p className="mt-2 text-sm">{dm.comment}</p> : null}
                  {p ? (
                    <button type="button" onClick={() => openPhoto(p)} className="mt-2 block w-full">
                      <MediaThumb path={p.report_path ?? p.storage_path} className="w-full rounded-lg object-cover" />
                    </button>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="rounded-xl bg-foreground p-4 text-background">
        <div className="text-xs uppercase tracking-widest opacity-70">
          Estimation totale des remises en état
        </div>
        <div className="text-3xl font-extrabold text-brand">{euro(total)}</div>
        {pending > 0 ? (
          <div className="text-xs opacity-80">{pending} poste(s) restant à chiffrer.</div>
        ) : null}
      </section>

      {e.market_value != null || e.buyback_value != null || e.valuation_comment ? (
        <section className="card-surface p-4">
          <h2 className="text-sm font-extrabold uppercase tracking-wide">Valorisation</h2>
          <div className="mt-2">
            <Row
              k="Valeur marché estimée"
              v={e.market_value != null ? euro(Number(e.market_value)) : ""}
            />
            <Row k="Remises en état" v={total ? `- ${euro(total)}` : ""} />
            <Row
              k="Proposition de reprise"
              v={e.buyback_value != null ? euro(Number(e.buyback_value)) : ""}
            />
          </div>
          {e.valuation_comment ? (
            <p className="mt-3 rounded-lg bg-secondary p-3 text-sm">{e.valuation_comment}</p>
          ) : null}
        </section>
      ) : null}

      <section className="card-surface p-4">
        <h2 className="text-sm font-extrabold uppercase tracking-wide">
          Photos du véhicule ({photos.length})
        </h2>
        <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
          {photos.map((p) => (
            <figure key={p.id}>
              <button type="button" onClick={() => openPhoto(p)} className="block w-full">
                <MediaThumb path={p.report_path ?? p.storage_path} className="aspect-[4/3] w-full rounded-lg object-cover" />
              </button>
              <figcaption className="pt-1 text-[11px] text-muted-foreground">{p.label}</figcaption>
            </figure>
          ))}
        </div>
      </section>

      <p className="px-1 text-xs text-muted-foreground">
        Estimation indicative établie à partir des constats photographiques, hors démontage et sans
        valeur contractuelle.
      </p>
    </div>
  );
}