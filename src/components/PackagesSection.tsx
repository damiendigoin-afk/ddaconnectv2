/** Forfaits mécaniques : référentiels importés, filtres, recherche et historique. */
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";

import { supabase } from "@/integrations/supabase/client";
import { PackageImport } from "@/components/PackageImport";
import { SOURCE_KINDS, SOURCE_LABEL, type PackageRow, type SourceKind } from "@/lib/packages-import";

type Filter = "tous" | SourceKind | "renault" | "dacia" | "manuel";

const FILTERS: { key: Filter; label: string }[] = [
  { key: "tous", label: "Tous" },
  { key: "renault", label: "Renault" },
  { key: "dacia", label: "Dacia" },
  { key: "renault_public", label: "Public" },
  { key: "renault_pro_lld", label: "Pro / LLD" },
  { key: "manuel", label: "Saisie manuelle" },
];

const fmtDate = (v: string | null | undefined) =>
  v ? new Date(v).toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit", year: "numeric" }) : "—";

export function PackagesSection({
  packages,
  refetch,
}: {
  packages: PackageRow[];
  refetch: () => Promise<unknown>;
}) {
  const [filter, setFilter] = useState<Filter>("tous");
  const [onlyActive, setOnlyActive] = useState(true);
  const [search, setSearch] = useState("");
  const [showHistory, setShowHistory] = useState(false);

  const imports = useQuery({
    queryKey: ["service-package-imports"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("service_package_imports")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(30);
      if (error) throw error;
      return data ?? [];
    },
  });

  const counts = useMemo(() => {
    const map: Record<string, number> = {};
    for (const p of packages) {
      if (!p.active) continue;
      const key = p.source_kind ?? "manuel";
      map[key] = (map[key] ?? 0) + 1;
    }
    return map;
  }, [packages]);

  const lastImportByKind = useMemo(() => {
    const map: Record<string, string> = {};
    for (const p of packages) {
      const key = p.source_kind ?? "manuel";
      if (!p.imported_at) continue;
      if (!map[key] || p.imported_at > map[key]!) map[key] = p.imported_at;
    }
    return map;
  }, [packages]);

  /**
   * Le référentiel complet n'est plus déroulé sous le bloc d'import : il se
   * consulte par recherche (code, opération, famille, modèle, moteur, mots-clés).
   */
  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (q.length < 2) return [];
    return packages.filter((p) => {
      if (onlyActive && !p.active) return false;
      if (filter === "renault" && !/renault/i.test(p.brand)) return false;
      if (filter === "dacia" && !/dacia/i.test(p.brand)) return false;
      if (filter === "manuel" && p.source_kind) return false;
      if ((filter === "renault_public" || filter === "renault_pro_lld") && p.source_kind !== filter)
        return false;
      return [
        p.operation_code,
        p.label,
        p.operation_title,
        p.family,
        p.model,
        p.engine,
        p.generation,
        p.description,
        p.segment,
        p.brand,
      ]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(q));
    });
  }, [packages, filter, onlyActive, search]);

  return (
    <section className="card-surface space-y-3 p-4">
      <h2 className="text-sm font-bold uppercase tracking-widest">Forfaits mécaniques</h2>
      <p className="text-xs text-muted-foreground">
        Référentiel Renault / Dacia utilisé en priorité, puis équivalence par segment déduit,
        génération proche et motorisation. Sans forfait fiable, le moteur affiche « Nous contacter
        pour le devis ». Les mémentos Public sont en TTC, les mémentos Pro / LLD en HT : la nature du
        prix source est conservée et convertie une seule fois.
      </p>

      <div className="grid gap-2 sm:grid-cols-3">
        {[...SOURCE_KINDS.map((s) => s.key), "manuel" as const].map((key) => (
          <div key={key} className="rounded-lg border border-border p-2 text-xs">
            <div className="font-bold">
              {key === "manuel" ? "Saisie manuelle" : SOURCE_LABEL[key as SourceKind]}
            </div>
            <div className="text-muted-foreground">
              {counts[key] ?? 0} forfait(s) actif(s) · dernier import {fmtDate(lastImportByKind[key])}
            </div>
          </div>
        ))}
      </div>

      <PackageImport onImported={() => Promise.all([refetch(), imports.refetch()])} />

      <div className="flex flex-wrap gap-1">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            onClick={() => setFilter(f.key)}
            className={`rounded-lg border-2 px-2 py-1 text-[10px] font-bold uppercase ${
              filter === f.key ? "border-brand bg-brand/10" : "border-border"
            }`}
          >
            {f.label}
          </button>
        ))}
        <button
          onClick={() => setOnlyActive((v) => !v)}
          className={`rounded-lg border-2 px-2 py-1 text-[10px] font-bold uppercase ${
            onlyActive ? "border-brand bg-brand/10" : "border-border"
          }`}
        >
          {onlyActive ? "Actifs" : "Actifs + historiques"}
        </button>
        <button
          onClick={() => setShowHistory((v) => !v)}
          className="rounded-lg border-2 border-border px-2 py-1 text-[10px] font-bold uppercase"
        >
          Historique des imports
        </button>
      </div>

      <input
        value={search}
        onChange={(e) => setSearch(e.target.value)}
    placeholder="Rechercher : code, opération, famille, modèle, motorisation, mot-clé"
        className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
      />

      {showHistory ? (
        <div className="space-y-1 rounded-xl border border-border p-2 text-[11px]">
          {(imports.data ?? []).length === 0 ? (
            <p className="text-muted-foreground">Aucun import enregistré.</p>
          ) : (
            (imports.data ?? []).map((im) => (
              <div key={im.id as string} className="rounded-lg border border-border px-2 py-1">
                <div className="font-bold">
                  {SOURCE_LABEL[im.source_kind as SourceKind] ?? im.source_kind} · {im.file_name}
                </div>
                <div className="text-muted-foreground">
                  {fmtDate(im.created_at as string)} · {im.imported_by_name ?? "—"} ·{" "}
                  {im.lines_detected} détectée(s), {im.lines_imported} créée(s), {im.lines_updated}{" "}
                  mise(s) à jour
                  {im.version_label ? ` · version ${im.version_label}` : ""}
                </div>
                {Array.isArray(im.warnings) && im.warnings.length ? (
                  <ul className="mt-1 text-amber-700">
                    {(im.warnings as string[]).map((w, i) => (
                      <li key={i}>{w}</li>
                    ))}
                  </ul>
                ) : null}
              </div>
            ))
          )}
        </div>
      ) : null}

      {search.trim().length < 2 ? (
        <p className="rounded-lg border border-dashed border-border p-4 text-center text-xs text-muted-foreground">
          Saisissez au moins 2 caractères pour retrouver un forfait (code, opération, famille,
          modèle, motorisation).
        </p>
      ) : visible.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border p-4 text-center text-xs text-muted-foreground">
          Aucun forfait ne correspond à cette recherche.
        </p>
      ) : (
        <ul className="space-y-1 text-sm">
          {visible.slice(0, 200).map((p) => (
            <li key={p.id} className="rounded-lg border border-border px-3 py-2">
              <div className="flex justify-between gap-2">
                <span>
                  <span className="font-bold">{p.operation_code}</span> · {p.label} · {p.brand}{" "}
                  {p.model ?? p.segment ?? ""}
                  {p.generation ? ` ${p.generation}` : ""}
                  {p.engine ? ` · ${p.engine}` : ""}
                  {p.family ? ` · ${p.family}` : ""}
                </span>
                <span className="whitespace-nowrap font-bold">
                  {p.price_ttc != null
                    ? `${Number(p.price_ttc).toFixed(2)} € TTC`
                    : `${p.hours ?? 0} h`}
                </span>
              </div>
              <div className="text-[10px] uppercase tracking-widest text-muted-foreground">
                {p.source_kind ? SOURCE_LABEL[p.source_kind as SourceKind] ?? p.source_kind : "Saisie manuelle"}
                {p.source_version ? ` · ${p.source_version}` : ""}
                {p.source_page ? ` · p.${p.source_page}` : ""}
                {p.imported_at ? ` · importé le ${fmtDate(p.imported_at)}` : ""}
                {p.price_basis ? ` · prix source ${String(p.price_basis).toUpperCase()}` : ""}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
