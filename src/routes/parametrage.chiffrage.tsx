import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { AppShell } from "@/components/AppShell";
import { Field } from "@/components/bits";
import { useAuth } from "@/lib/auth";
import { supabase } from "@/integrations/supabase/client";
import type { CommercialSettings, PaintElementRule, ServicePackage } from "@/lib/pricing-engine";
import {
  GRADE_LABEL,
  SEASON_LABEL,
  SEVERITY_LABEL,
  TIER_LABEL,
  TIRE_SUPPLIERS,
  applyMargin,
  fetchBrandTiers,
  type BrandTierRow,
  type SeverityLevel,
  type TireOffer,
  type TireTier,
} from "@/lib/tires";

export const Route = createFileRoute("/parametrage/chiffrage")({
  head: () => ({
    meta: [
      { title: "Chiffrage & pneumatiques — DDA Connect" },
      {
        name: "description",
        content:
          "Paramètres du moteur central de chiffrage : politique de marge, forfaits mécaniques, règles peinture et catalogue pneumatiques.",
      },
      { property: "og:title", content: "Chiffrage & pneumatiques — DDA Connect" },
      { property: "og:description", content: "Marge, forfaits, règles peinture et tarifs pneumatiques." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: PricingSettings,
});

function PricingSettings() {
  const { isManager } = useAuth();

  const settings = useQuery({
    queryKey: ["commercial-settings"],
    queryFn: async () => {
      const { data, error } = await supabase.from("commercial_settings").select("*").limit(1).maybeSingle();
      if (error) throw error;
      return (data ?? null) as CommercialSettings | null;
    },
  });
  const packages = useQuery({
    queryKey: ["service-packages"],
    queryFn: async () => {
      const { data, error } = await supabase.from("service_packages").select("*").order("operation_code");
      if (error) throw error;
      return (data ?? []) as ServicePackage[];
    },
  });
  const paint = useQuery({
    queryKey: ["paint-rules"],
    queryFn: async () => {
      const { data, error } = await supabase.from("paint_element_rules").select("*").order("element_size");
      if (error) throw error;
      return (data ?? []) as PaintElementRule[];
    },
  });
  const tires = useQuery({
    queryKey: ["tire-offers"],
    queryFn: async () => {
      const { data, error } = await supabase.from("tire_offers").select("*").order("tier");
      if (error) throw error;
      return (data ?? []) as TireOffer[];
    },
  });

  const brands = useQuery({ queryKey: ["tire-brand-tiers"], queryFn: fetchBrandTiers });

  const [pct, setPct] = useState("");
  const [minHt, setMinHt] = useState("");
  const [supplier, setSupplier] = useState("catalogue_local");
  const [severity, setSeverity] = useState<SeverityLevel>("standard");
  const [good, setGood] = useState("4");
  const [soon, setSoon] = useState("3");
  const [legal, setLegal] = useState("1.6");
  const [newBrand, setNewBrand] = useState("");
  const [newTier, setNewTier] = useState<TireTier>("entree");

  useEffect(() => {
    const s = settings.data;
    if (!s) return;
    setPct(String(s.margin_pct));
    setMinHt(String(s.min_margin_ht));
    setSupplier(s.tire_supplier);
    setSeverity((s.ai_severity_level as SeverityLevel) ?? "standard");
    setGood(String(s.tire_depth_good_mm));
    setSoon(String(s.tire_depth_soon_mm));
    setLegal(String(s.tire_depth_legal_mm));
  }, [settings.data]);

  async function saveSettings() {
    const s = settings.data;
    if (!s) return;
    const { error } = await supabase
      .from("commercial_settings")
      .update({
        margin_pct: Number(pct) || 0,
        min_margin_ht: Number(minHt) || 0,
        tire_supplier: supplier,
        tire_supplier_configured: supplier === "catalogue_local",
        ai_severity_level: severity,
        tire_depth_good_mm: Number(good.replace(",", ".")) || 4,
        tire_depth_soon_mm: Number(soon.replace(",", ".")) || 3,
        tire_depth_legal_mm: Number(legal.replace(",", ".")) || 1.6,
        updated_at: new Date().toISOString(),
      })
      .eq("id", s.id);
    if (error) {
      toast.error("Enregistrement impossible");
      return;
    }
    toast.success("Politique commerciale enregistrée");
    await settings.refetch();
  }

  async function savePaint(rule: PaintElementRule, patch: Partial<PaintElementRule>) {
    const { error } = await supabase.from("paint_element_rules").update(patch as never).eq("id", rule.id);
    if (error) {
      toast.error("Modification impossible");
      return;
    }
    await paint.refetch();
  }

  async function saveBrand(row: BrandTierRow, patch: Partial<BrandTierRow>) {
    const { error } = await supabase.from("tire_brand_tiers").update(patch as never).eq("id", row.id);
    if (error) {
      toast.error("Modification impossible");
      return;
    }
    await brands.refetch();
  }

  async function setDefaultBrand(row: BrandTierRow) {
    await supabase.from("tire_brand_tiers").update({ is_default: false }).eq("tier", row.tier);
    await saveBrand(row, { is_default: true, active: true });
  }

  async function addBrand() {
    const brand = newBrand.trim();
    if (!brand) return;
    const max = Math.max(0, ...(brands.data ?? []).filter((b) => b.tier === newTier).map((b) => b.sort_order));
    const { error } = await supabase
      .from("tire_brand_tiers")
      .insert({ tier: newTier, brand, sort_order: max + 1 });
    if (error) {
      toast.error("Marque déjà présente dans cette gamme");
      return;
    }
    setNewBrand("");
    await brands.refetch();
    toast.success("Marque ajoutée");
  }

  if (!isManager) {
    return (
      <AppShell title="Chiffrage & pneumatiques" back={{ to: "/parametrage" }}>
        <p className="rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
          Réservé aux managers du garage.
        </p>
      </AppShell>
    );
  }

  const example = applyMargin(100, {
    margin_pct: Number(pct) || 0,
    min_margin_ht: Number(minHt) || 0,
  } as CommercialSettings);
  const supplierDef = TIRE_SUPPLIERS.find((s) => s.key === supplier);

  return (
    <AppShell title="Chiffrage & pneumatiques" back={{ to: "/parametrage" }}>
      <div className="space-y-6">
        <section className="card-surface space-y-3 p-4">
          <h2 className="text-sm font-bold uppercase tracking-widest">Politique commerciale</h2>
          <p className="text-xs text-muted-foreground">
            Marge appliquée = MAX(prix d'achat × pourcentage ; marge minimale fixe HT). Règle
            réutilisée pour les pneus, batteries, accessoires et tout produit revendu. Aucune valeur
            n'est imposée : renseignez le pourcentage et la marge minimale retenus par le garage.
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Pourcentage de marge (%)" value={pct} onChange={setPct} />
            <Field label="Marge minimale fixe (€ HT)" value={minHt} onChange={setMinHt} />
          </div>
          {Number(pct) === 0 && Number(minHt) === 0 ? (
            <p className="text-xs text-amber-700">
              Politique commerciale non renseignée : les prix de revente sont affichés au prix
              d'achat tant qu'aucune marge n'est validée.
            </p>
          ) : null}

          <p className="text-xs text-muted-foreground">
            Exemple : achat 100 € HT → marge {example.marginHt.toFixed(2)} € → vente{" "}
            {example.sellHt.toFixed(2)} € HT.
          </p>
          <div>
            <label className="text-xs font-bold uppercase tracking-widest text-muted-foreground">
              Source tarifaire pneumatiques
            </label>
            <select
              value={supplier}
              onChange={(e) => setSupplier(e.target.value)}
              className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-3 text-sm"
            >
              {TIRE_SUPPLIERS.map((s) => (
                <option key={s.key} value={s.key}>
                  {s.label}
                </option>
              ))}
            </select>
            {supplierDef && !supplierDef.configured ? (
              <p className="mt-1 text-xs text-amber-700">
                Source non configurée : aucun tarif n'est récupéré tant que l'accès technique n'est
                pas confirmé. Le catalogue local reste utilisé.
              </p>
            ) : null}
          </div>
          <div>
            <label className="text-xs font-bold uppercase tracking-widest text-muted-foreground">
              Niveau de sévérité de l'analyse visuelle
            </label>
            <select
              value={severity}
              onChange={(e) => setSeverity(e.target.value as SeverityLevel)}
              className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-3 text-sm"
            >
              {(Object.keys(SEVERITY_LABEL) as SeverityLevel[]).map((k) => (
                <option key={k} value={k}>
                  {SEVERITY_LABEL[k]}
                </option>
              ))}
            </select>
            <p className="mt-1 text-xs text-muted-foreground">
              Réglage unique et réversible, partagé par tous les modules d'analyse visuelle. Il ne
              modifie que les appréciations subjectives (craquelures, vieillissement, usure
              irrégulière, formulation) : jamais la limite légale, la grille objective ni un danger
              manifeste.
            </p>
          </div>

          <div>
            <h3 className="text-xs font-bold uppercase tracking-widest text-muted-foreground">
              Grille d'usure pneumatique
            </h3>
            <div className="mt-1 grid gap-3 sm:grid-cols-3">
              <Field label="Bon état au-dessus de (mm)" value={good} onChange={setGood} />
              <Field label="Remplacement rapide en dessous de (mm)" value={soon} onChange={setSoon} />
              <Field label="Limite légale (mm)" value={legal} onChange={setLegal} />
            </div>
            <ul className="mt-2 space-y-1 text-xs text-muted-foreground">
              <li>&gt; {good} mm : {GRADE_LABEL.correct}</li>
              <li>de {soon} à {good} mm inclus : {GRADE_LABEL.a_prevoir}</li>
              <li>&gt; {legal} mm et &lt; {soon} mm : {GRADE_LABEL.rapide}</li>
              <li>&le; {legal} mm : {GRADE_LABEL.imperatif}</li>
            </ul>
            <p className="mt-1 text-xs text-muted-foreground">
              La profondeur ne suffit pas : hernie, coupure grave, toile visible, fortes craquelures
              ou usure très irrégulière aggravent le jugement. Les règles légales et les dangers
              manifestes restent prioritaires.
            </p>
          </div>

          <button
            onClick={() => void saveSettings()}
            className="w-full rounded-xl bg-brand px-4 py-3 text-sm font-bold uppercase text-brand-foreground"
          >
            Enregistrer
          </button>
        </section>

        <section className="card-surface space-y-3 p-4">
          <h2 className="text-sm font-bold uppercase tracking-widest">Marques par gamme</h2>
          <p className="text-xs text-muted-foreground">
            Marque retenue par défaut pour chaque gamme lors de la préparation des sept propositions
            pneumatiques. Aucune substitution silencieuse : si la marque par défaut n'a pas d'offre,
            la proposition affiche « Offre indisponible dans cette marque ».
          </p>
          {(["entree", "milieu", "haut"] as TireTier[]).map((tier) => (
            <div key={tier} className="rounded-xl border border-border p-3">
              <div className="text-xs font-bold uppercase tracking-widest">{TIER_LABEL[tier]}</div>
              <ul className="mt-2 space-y-1">
                {(brands.data ?? [])
                  .filter((b) => b.tier === tier)
                  .map((b) => (
                    <li key={b.id} className="flex items-center justify-between gap-2 text-sm">
                      <span className={b.active ? "" : "text-muted-foreground line-through"}>{b.brand}</span>
                      <span className="flex items-center gap-2">
                        <button
                          onClick={() => void setDefaultBrand(b)}
                          className={`rounded-lg border-2 px-2 py-1 text-[10px] font-bold uppercase ${
                            b.is_default ? "border-brand bg-brand/10" : "border-border"
                          }`}
                        >
                          {b.is_default ? "Par défaut" : "Définir par défaut"}
                        </button>
                        <button
                          onClick={() => void saveBrand(b, { active: !b.active })}
                          className="rounded-lg border-2 border-border px-2 py-1 text-[10px] font-bold uppercase"
                        >
                          {b.active ? "Désactiver" : "Activer"}
                        </button>
                        <select
                          value={b.tier}
                          onChange={(e) => void saveBrand(b, { tier: e.target.value })}
                          className="rounded-lg border border-border bg-background px-1 py-1 text-[10px]"
                        >
                          <option value="entree">Entrée</option>
                          <option value="milieu">Milieu</option>
                          <option value="haut">Haut</option>
                        </select>
                      </span>
                    </li>
                  ))}
              </ul>
            </div>
          ))}
          <div className="flex items-end gap-2">
            <div className="flex-1">
              <Field label="Ajouter une marque" value={newBrand} onChange={setNewBrand} />
            </div>
            <select
              value={newTier}
              onChange={(e) => setNewTier(e.target.value as TireTier)}
              className="rounded-lg border border-border bg-background px-2 py-3 text-sm"
            >
              <option value="entree">Entrée</option>
              <option value="milieu">Milieu</option>
              <option value="haut">Haut</option>
            </select>
            <button
              onClick={() => void addBrand()}
              className="rounded-lg bg-brand px-3 py-3 text-xs font-bold uppercase text-brand-foreground"
            >
              Ajouter
            </button>
          </div>
        </section>

        <section className="card-surface space-y-3 p-4">
          <h2 className="text-sm font-bold uppercase tracking-widest">Règles peinture par élément</h2>
          <p className="text-xs text-muted-foreground">
            Temps de peinture et temps de réparation distincts et modifiables. Colorimétrie : 1 h par
            intervention peinture (pas par élément). IGP = heures peinture + heures colorimétrie. Les
            temps de dépose/repose restent vides tant qu'un barème n'est pas validé : ils ne sont pas
            chiffrés automatiquement.
          </p>
          <div className="space-y-2">
            {(paint.data ?? []).map((r) => {
              const drOps =
                (r.dr_operations as { code: string; label: string; hours: number | null }[] | null) ??
                [];
              return (
                <div key={r.id} className="rounded-xl border border-border p-3">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-bold">{r.label}</span>
                    <span className="text-xs uppercase text-muted-foreground">{r.element_size}</span>
                  </div>
                  <div className="mt-2 grid grid-cols-2 gap-2">
                    <Field
                      label="Peinture (h)"
                      value={String(r.paint_hours)}
                      onChange={(v) => void savePaint(r, { paint_hours: Number(v) || 0 })}
                    />
                    <Field
                      label="Réparation (h)"
                      value={String(r.repair_hours_default)}
                      onChange={(v) => void savePaint(r, { repair_hours_default: Number(v) || 0 })}
                    />
                  </div>
                  {drOps.length ? (
                    <div className="mt-2 space-y-2">
                      <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground">
                        Dépose / repose associées
                      </p>
                      {drOps.map((op, i) => (
                        <Field
                          key={op.code}
                          label={`${op.label} (h)${op.hours == null ? " — non renseigné" : ""}`}
                          value={op.hours == null ? "" : String(op.hours)}
                          onChange={(v) => {
                            const next = drOps.map((o, j) =>
                              j === i ? { ...o, hours: v.trim() === "" ? null : Number(v) || 0 } : o,
                            );
                            void savePaint(r, { dr_operations: next as never });
                          }}
                        />
                      ))}
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>

        </section>

        <section className="card-surface space-y-3 p-4">
          <h2 className="text-sm font-bold uppercase tracking-widest">Forfaits mécaniques</h2>
          <p className="text-xs text-muted-foreground">
            Référentiel Renault / Dacia utilisé en priorité, puis équivalence par segment déduit,
            génération proche et motorisation. Sans forfait fiable, le moteur affiche « Nous
            contacter pour le devis ».
          </p>
          {(packages.data ?? []).length === 0 ? (
            <p className="rounded-lg border border-dashed border-border p-4 text-center text-xs text-muted-foreground">
              Aucun forfait chargé pour l'instant : le référentiel Renault/Dacia 2026 doit être
              importé pour activer le chiffrage mécanique automatique.
            </p>
          ) : (
            <ul className="space-y-1 text-sm">
              {(packages.data ?? []).map((p) => (
                <li key={p.id} className="flex justify-between rounded-lg border border-border px-3 py-2">
                  <span>
                    {p.label} · {p.brand} {p.model ?? p.segment ?? ""}
                  </span>
                  <span className="font-bold">
                    {p.price_ttc != null ? `${Number(p.price_ttc).toFixed(2)} € TTC` : `${p.hours ?? 0} h`}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="card-surface space-y-3 p-4">
          <h2 className="text-sm font-bold uppercase tracking-widest">Catalogue pneumatiques</h2>
          {(tires.data ?? []).length === 0 ? (
            <p className="rounded-lg border border-dashed border-border p-4 text-center text-xs text-muted-foreground">
              Aucun tarif pneu enregistré : ajoutez vos prix d'achat pour activer les propositions
              (Été / 4 saisons × entrée, milieu, haut de gamme).
            </p>
          ) : (
            <ul className="space-y-1 text-sm">
              {(tires.data ?? []).map((t) => {
                const m = applyMargin(Number(t.purchase_price_ht), settings.data ?? null);
                return (
                  <li key={t.id} className="flex justify-between rounded-lg border border-border px-3 py-2">
                    <span>
                      {t.brand} {t.model} · {t.size ?? "toutes dimensions"} ·{" "}
                      {SEASON_LABEL[t.season as keyof typeof SEASON_LABEL]} ·{" "}
                      {TIER_LABEL[t.tier as keyof typeof TIER_LABEL]}
                    </span>
                    <span className="font-bold">{m.sellHt.toFixed(2)} € HT</span>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </div>
    </AppShell>
  );
}
