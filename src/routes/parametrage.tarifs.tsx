import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { AppShell } from "@/components/AppShell";
import { useAuth } from "@/lib/auth";
import {
  CATEGORY_LABEL,
  duplicateGrid,
  fetchGrids,
  fetchRates,
  updateRate,
  type PricingGrid,
  type PricingRate,
  type RateCategory,
} from "@/lib/pricing";

export const Route = createFileRoute("/parametrage/tarifs")({
  head: () => ({
    meta: [
      { title: "Tarifs atelier — DDA Connect" },
      {
        name: "description",
        content:
          "Grille tarifaire de l'atelier : taux horaires de main-d'œuvre, ingrédients peinture et forfaits, modifiables avec date de prise d'effet.",
      },
      { property: "og:title", content: "Tarifs atelier — DDA Connect" },
      { property: "og:description", content: "Taux horaires, IGP et forfaits atelier, historisés par grille." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: WorkshopRates,
});

const ORDER: RateCategory[] = ["labor", "igp", "service"];

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function WorkshopRates() {
  const { isManager } = useAuth();
  const grids = useQuery({ queryKey: ["pricing-grids"], queryFn: fetchGrids });
  const [gridId, setGridId] = useState<string | null>(null);

  const list = grids.data ?? [];
  const current = list.find((g) => g.id === gridId) ?? null;

  useEffect(() => {
    if (!gridId && list.length) {
      const active = list.find((g) => g.effective_from <= todayIso()) ?? list[0]!;
      setGridId(active.id);
    }
  }, [gridId, list]);

  const rates = useQuery({
    queryKey: ["pricing-rates", gridId],
    queryFn: () => fetchRates(gridId!),
    enabled: !!gridId,
  });

  async function save(r: PricingRate, field: "amount_ht" | "amount_ttc", raw: string) {
    if (!isManager) return;
    const value = raw.trim() === "" ? null : Number(raw.replace(",", "."));
    if (value != null && Number.isNaN(value)) {
      toast.error("Montant invalide");
      return;
    }
    try {
      await updateRate(r.id, { [field]: value });
      toast.success("Tarif enregistré");
      await rates.refetch();
    } catch {
      toast.error("Enregistrement refusé");
    }
  }

  return (
    <AppShell title="Tarifs atelier" subtitle="Grille tarifaire du garage" back={{ to: "/parametrage/global" }}>
      {!isManager ? (
        <p className="rounded-lg bg-amber-100 px-3 py-3 text-sm text-amber-950">
          Consultation seule : seul un manager peut modifier les tarifs.
        </p>
      ) : null}

      <div className="space-y-3 pt-2">
        <label className="block">
          <span className="mb-1 block text-xs font-bold uppercase tracking-wide text-muted-foreground">
            Grille tarifaire
          </span>
          <select
            value={gridId ?? ""}
            onChange={(e) => setGridId(e.target.value)}
            className="w-full rounded-lg border-2 border-border bg-card px-3 py-3 text-base"
          >
            {list.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name} — effet au {new Date(g.effective_from).toLocaleDateString("fr-FR")}
                {g.effective_from <= todayIso() ? " (en vigueur)" : " (à venir)"}
              </option>
            ))}
          </select>
        </label>

        {current?.notes ? <p className="text-xs text-muted-foreground">{current.notes}</p> : null}

        {ORDER.map((cat) => {
          const rows = (rates.data ?? []).filter((r) => r.category === cat);
          if (!rows.length) return null;
          return (
            <section key={cat} className="space-y-2">
              <h2 className="px-1 pt-3 text-sm font-extrabold uppercase tracking-wide">{CATEGORY_LABEL[cat]}</h2>
              <ul className="space-y-2">
                {rows.map((r) => (
                  <li key={r.id} className="rounded-xl border-2 border-border bg-card px-4 py-3">
                    <div className="text-sm font-bold">{r.label}</div>
                    <div className="text-[11px] uppercase text-muted-foreground">
                      {r.unit === "heure" ? "par heure" : r.unit === "jour" ? "par jour" : "forfait"}
                    </div>
                    <div className="mt-2 flex items-center gap-2">
                      <AmountInput
                        label="HT"
                        disabled={!isManager}
                        value={r.amount_ht}
                        onCommit={(v) => void save(r, "amount_ht", v)}
                      />
                      <AmountInput
                        label="TTC"
                        disabled={!isManager}
                        value={r.amount_ttc}
                        onCommit={(v) => void save(r, "amount_ttc", v)}
                      />
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          );
        })}

        {isManager && current ? <NewGridForm source={current} onDone={() => void grids.refetch()} /> : null}

        <p className="rounded-lg bg-muted px-3 py-3 text-xs text-muted-foreground">
          Règles appliquées par le moteur de chiffrage : le Taux 2 est le taux technique par défaut des interventions
          carrosserie / peinture · la colorimétrie compte 1,0 h par intervention peinture · 1 h de peinture génère 1 h
          d'ingrédients peinture, colorimétrie incluse · le tarif IGP dépend du type de peinture. Les chiffrages déjà
          établis conservent les taux en vigueur au moment de leur création.
        </p>
      </div>
    </AppShell>
  );
}

function AmountInput({
  label,
  value,
  disabled,
  onCommit,
}: {
  label: string;
  value: number | null;
  disabled: boolean;
  onCommit: (v: string) => void;
}) {
  return (
    <label className="flex flex-1 items-center gap-2">
      <span className="w-8 text-[11px] font-bold uppercase text-muted-foreground">{label}</span>
      <input
        type="number"
        step="0.01"
        disabled={disabled}
        defaultValue={value == null ? "" : String(value)}
        onBlur={(e) => {
          if (String(value ?? "") !== e.target.value) onCommit(e.target.value);
        }}
        className="w-full rounded-lg border-2 border-border bg-background px-3 py-2.5 text-right text-base font-extrabold disabled:opacity-60"
      />
      <span className="text-sm font-bold text-muted-foreground">€</span>
    </label>
  );
}

function NewGridForm({ source, onDone }: { source: PricingGrid; onDone: () => void }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [from, setFrom] = useState("");
  const [busy, setBusy] = useState(false);

  async function create() {
    setBusy(true);
    try {
      await duplicateGrid({ sourceGridId: source.id, name: name.trim(), effectiveFrom: from });
      toast.success("Nouvelle grille créée");
      setOpen(false);
      setName("");
      setFrom("");
      onDone();
    } catch {
      toast.error("Création impossible");
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="mt-2 w-full rounded-lg border-2 border-dashed border-border px-3 py-3 text-xs font-extrabold uppercase"
      >
        Créer une nouvelle grille à partir de « {source.name} »
      </button>
    );
  }

  return (
    <div className="space-y-3 rounded-xl border-2 border-border bg-card px-4 py-4">
      <div className="text-sm font-extrabold uppercase">Nouvelle grille tarifaire</div>
      <label className="block">
        <span className="mb-1 block text-xs font-bold uppercase text-muted-foreground">Nom</span>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Grille DDA 2027"
          className="w-full rounded-lg border-2 border-border bg-background px-3 py-3 text-base"
        />
      </label>
      <label className="block">
        <span className="mb-1 block text-xs font-bold uppercase text-muted-foreground">Date de prise d'effet</span>
        <input
          type="date"
          value={from}
          onChange={(e) => setFrom(e.target.value)}
          className="w-full rounded-lg border-2 border-border bg-background px-3 py-3 text-base"
        />
      </label>
      <div className="flex gap-2">
        <button
          onClick={() => void create()}
          disabled={busy || !name.trim() || !from}
          className="rounded-lg bg-brand px-3 py-2 text-xs font-extrabold uppercase text-brand-foreground disabled:opacity-60"
        >
          {busy ? "Création…" : "Créer la grille"}
        </button>
        <button
          onClick={() => setOpen(false)}
          className="rounded-lg border-2 border-border px-3 py-2 text-xs font-extrabold uppercase"
        >
          Annuler
        </button>
      </div>
      <p className="text-[11px] text-muted-foreground">
        Les tarifs sont copiés depuis la grille sélectionnée. L'ancienne grille reste consultable en historique et les
        chiffrages antérieurs ne sont pas modifiés.
      </p>
    </div>
  );
}
