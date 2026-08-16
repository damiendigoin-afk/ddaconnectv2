import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { BookUser, FileSpreadsheet, Plus } from "lucide-react";

import { AppShell } from "@/components/AppShell";
import { Badge, Counter } from "@/components/bits";
import { useAuth } from "@/lib/auth";
import {
  COUNTER_FILTERS,
  computeCounters,
  isLate,
  listCases,
  physicalLabel,
  stateLabel,
  stateTone,
} from "@/lib/bodyshop";
import { formatPlate } from "@/lib/plate";

export const Route = createFileRoute("/carrosserie/")({
  head: () => ({
    meta: [
      { title: "Carrosserie — DDA Connect" },
      { name: "description", content: "Pilotage des dossiers carrosserie : missions, experts, pièces, planning et paiements." },
      { property: "og:title", content: "Carrosserie — DDA Connect" },
      { property: "og:description", content: "Dossiers carrosserie, EAD, compléments experts et suivi financier." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: BodyshopHub,
});

function BodyshopHub() {
  const navigate = useNavigate();
  const { isManager } = useAuth();
  const [filter, setFilter] = useState<string>("");
  const [term, setTerm] = useState("");
  const cases = useQuery({ queryKey: ["bodyshop-cases"], queryFn: listCases });

  const rows = cases.data ?? [];
  const counters = useMemo(() => computeCounters(rows), [rows]);

  const visible = useMemo(() => {
    const f = COUNTER_FILTERS.find((c) => c.key === filter);
    let list = f ? rows.filter((r) => r.case_state !== "dossier_clos" && f.match(r)) : rows;
    const t = term.trim().toLowerCase();
    if (t) {
      list = list.filter((r) =>
        [r.plate, r.customer_name, r.or_number, r.claim_number, r.vehicle_label]
          .filter(Boolean)
          .some((v) => String(v).toLowerCase().includes(t)),
      );
    }
    return list;
  }, [rows, filter, term]);

  return (
    <AppShell
      title="Carrosserie"
      subtitle="Dossiers, experts et planning"
      back={{ to: "/" }}
      right={
        isManager ? (
          <Link to="/carrosserie/referentiels" aria-label="Référentiels" className="rounded-lg border border-border p-2 text-muted-foreground">
            <BookUser className="h-4 w-4" />
          </Link>
        ) : null
      }
    >
      <button
        onClick={() => void navigate({ to: "/carrosserie/nouvelle" })}
        className="flex w-full items-center gap-3 rounded-xl bg-brand px-4 py-5 text-brand-foreground active:scale-[0.99]"
      >
        <Plus className="h-7 w-7" />
        <span className="flex-1 text-left text-lg font-extrabold uppercase tracking-wide">Nouveau dossier</span>
      </button>

      {isManager ? (
        <Link
          to="/carrosserie/import"
          className="mt-2 flex w-full items-center gap-3 rounded-xl border-2 border-border bg-card px-4 py-3 active:scale-[0.99]"
        >
          <FileSpreadsheet className="h-5 w-5 text-brand" />
          <span className="flex-1 text-left text-sm font-extrabold uppercase tracking-wide">
            Initialiser / Importer le suivi missions
          </span>
        </Link>
      ) : null}

      <div className="mt-4 grid grid-cols-3 gap-2">
        {COUNTER_FILTERS.map((c) => (
          <Counter
            key={c.key}
            label={c.label}
            value={counters[c.key]}
            active={filter === c.key}
            onClick={() => setFilter(filter === c.key ? "" : c.key)}
          />
        ))}
      </div>

      <input
        value={term}
        onChange={(e) => setTerm(e.target.value)}
        placeholder="Immat, client, n° OR, n° sinistre…"
        aria-label="Rechercher un dossier"
        className="mt-4 w-full rounded-xl border-2 border-border bg-card px-4 py-3 text-base outline-none focus:border-brand"
      />

      <h2 className="px-1 pb-2 pt-5 text-sm font-extrabold uppercase tracking-wide">
        {filter ? COUNTER_FILTERS.find((c) => c.key === filter)?.label : "Dossiers"} ({visible.length})
      </h2>

      {cases.isLoading ? (
        <p className="text-sm text-muted-foreground">Chargement…</p>
      ) : visible.length ? (
        <ul className="space-y-2">
          {visible.map((c) => (
            <li key={c.id}>
              <Link to="/carrosserie/$caseId" params={{ caseId: c.id }} className="card-surface block p-4 active:scale-[0.995]">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="plate-badge text-xl">{formatPlate(c.plate ?? "")}</div>
                    <div className="truncate text-sm font-medium">{c.vehicle_label ?? "—"}</div>
                    <div className="truncate text-xs text-muted-foreground">{c.customer_name ?? "—"}</div>
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1">
                    <Badge tone={stateTone(c.case_state)}>{stateLabel(c.case_state)}</Badge>
                    <span className="text-[11px] text-muted-foreground">{physicalLabel(c.physical_state)}</span>
                    {isLate(c) ? <Badge tone="bg-red-200 text-red-950">Retard</Badge> : null}
                  </div>
                </div>
                {c.next_action ? (
                  <p className="mt-2 rounded-lg bg-secondary px-3 py-2 text-sm">➜ {c.next_action}</p>
                ) : null}
                {c.blocker ? (
                  <p className="mt-2 rounded-lg bg-red-100 px-3 py-2 text-sm text-red-950">⛔ {c.blocker}</p>
                ) : null}
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground">Aucun dossier.</p>
      )}
    </AppShell>
  );
}
