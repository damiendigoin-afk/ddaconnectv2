import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { ChevronRight, Plus, Search } from "lucide-react";

import { AppShell } from "@/components/AppShell";
import { Badge, Field, Select } from "@/components/bits";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { listSuppliers, SUPPLIER_CATEGORIES } from "@/lib/suppliers";

export const Route = createFileRoute("/parametrage/fournisseurs/")({
  head: () => ({
    meta: [
      { title: "Fournisseurs — Paramétrage global DDA Connect" },
      { name: "description", content: "Référentiel fournisseurs unique de DDA Connect : concessions, distributeurs de pièces, prestataires et leurs contacts." },
      { property: "og:title", content: "Fournisseurs — Paramétrage global DDA Connect" },
      { property: "og:description", content: "Un seul référentiel fournisseurs partagé par tous les modules." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: SuppliersPage,
});

function SuppliersPage() {
  const { isManager } = useAuth();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["suppliers"], queryFn: listSuppliers });
  const [search, setSearch] = useState("");
  const [cat, setCat] = useState("");
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [category, setCategory] = useState("pieces");

  const rows = useMemo(() => {
    const s = search.trim().toLowerCase();
    return (q.data ?? []).filter((r) => {
      if (cat && r.category !== cat) return false;
      if (!s) return true;
      return [r.name, r.trade_name, r.group_name, r.brands, r.city].some((v) => (v ?? "").toLowerCase().includes(s));
    });
  }, [q.data, search, cat]);

  if (!isManager) {
    return (
      <AppShell title="Fournisseurs" back={{ to: "/parametrage" }}>
        <p className="rounded-lg bg-amber-100 px-3 py-3 text-sm text-amber-950">Accès réservé aux managers.</p>
      </AppShell>
    );
  }

  return (
    <AppShell title="Fournisseurs" subtitle="Référentiel global, tous modules" back={{ to: "/parametrage" }}>
      <div className="space-y-3 pt-2">
        <label className="flex items-center gap-2 rounded-lg border-2 border-border bg-card px-3">
          <Search className="h-4 w-4 text-muted-foreground" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Nom, enseigne, groupe, marque, ville…"
            className="w-full bg-transparent py-3 text-base outline-none"
          />
        </label>
        <Select
          label="Catégorie"
          value={cat}
          onChange={setCat}
          options={SUPPLIER_CATEGORIES.map((c) => ({ key: c.key, label: c.label }))}
        />

        {creating ? (
          <div className="space-y-2 rounded-xl border-2 border-border bg-card p-3">
            <Field label="Nom / raison sociale" value={name} onChange={setName} />
            <Select
              label="Catégorie"
              value={category}
              onChange={setCategory}
              options={SUPPLIER_CATEGORIES.map((c) => ({ key: c.key, label: c.label }))}
              allowEmpty={false}
            />
            <button
              onClick={async () => {
                if (!name.trim()) return;
                await supabase.from("suppliers").insert({ name: name.trim(), category });
                setName("");
                setCreating(false);
                void qc.invalidateQueries({ queryKey: ["suppliers"] });
              }}
              className="w-full rounded-lg bg-brand py-3 text-sm font-extrabold uppercase text-brand-foreground"
            >
              Créer le fournisseur
            </button>
          </div>
        ) : (
          <button
            onClick={() => setCreating(true)}
            className="flex w-full items-center justify-center gap-2 rounded-lg bg-brand py-3 text-sm font-extrabold uppercase text-brand-foreground"
          >
            <Plus className="h-4 w-4" /> Nouveau fournisseur
          </button>
        )}

        <ul className="space-y-2">
          {rows.map((s) => (
            <li key={s.id}>
              <Link
                to="/parametrage/fournisseurs/$supplierId"
                params={{ supplierId: s.id }}
                className="flex items-center gap-3 rounded-xl border-2 border-border bg-card p-3 text-sm active:scale-[0.99]"
              >
                <div className="min-w-0 flex-1">
                  <div className="truncate font-bold">{s.trade_name || s.name}</div>
                  <div className="truncate text-xs text-muted-foreground">
                    {[s.group_name, s.brands, s.city].filter(Boolean).join(" · ") || "—"}
                  </div>
                </div>
                {!s.active ? <Badge tone="bg-muted text-muted-foreground">Inactif</Badge> : null}
                <ChevronRight className="h-5 w-5 shrink-0 text-muted-foreground" />
              </Link>
            </li>
          ))}
          {rows.length === 0 ? <li className="px-1 text-sm text-muted-foreground">Aucun fournisseur.</li> : null}
        </ul>
      </div>
    </AppShell>
  );
}
