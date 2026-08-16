import { Camera, Loader2, Plus, Search } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import {
  customerName,
  refPrefillByVehicle,
  universalSearch,
  vehicleLabel,
  type RefPrefill,
  type SearchResult,
} from "@/lib/refbase";

export type EntityPick = RefPrefill & { orderId?: string };

/** Recherche semi-automatique Client / Véhicule, identique partout dans DDA Connect. */
export function EntitySearch({
  placeholder = "Immat, nom, téléphone, VIN, n° OR…",
  label,
  onPick,
  onCreateNew,
  onScan,
  scanning = false,
  initialTerm = "",
  autoFocus = false,
}: {
  placeholder?: string;
  label?: string;
  onPick: (pick: EntityPick) => void;
  onCreateNew?: (term: string) => void;
  onScan?: (file: File) => void;
  scanning?: boolean;
  initialTerm?: string;
  autoFocus?: boolean;
}) {
  const [term, setTerm] = useState(initialTerm);
  const [loading, setLoading] = useState(false);
  const [res, setRes] = useState<SearchResult | null>(null);
  const [picking, setPicking] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const t = term.trim();
    if (t.length < 2) {
      setRes(null);
      return;
    }
    let alive = true;
    setLoading(true);
    const timer = setTimeout(() => {
      universalSearch(t)
        .then((r) => alive && setRes(r))
        .catch(() => alive && setRes(null))
        .finally(() => alive && setLoading(false));
    }, 220);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [term]);

  async function pickVehicle(vehicleId: string, orderId?: string) {
    setPicking(true);
    try {
      const prefill = await refPrefillByVehicle(vehicleId);
      if (prefill) onPick(orderId ? { ...prefill, orderId } : prefill);
    } finally {
      setPicking(false);
    }
  }

  const empty =
    res && !res.customers.length && !res.vehicles.length && !res.orders.length && term.trim().length >= 2;

  return (
    <div className="space-y-3">
      {label ? (
        <span className="block text-xs font-bold uppercase tracking-wide text-muted-foreground">{label}</span>
      ) : null}
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-muted-foreground" />
          {loading || picking ? (
            <Loader2 className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-muted-foreground" />
          ) : null}
          <input
            value={term}
            autoFocus={autoFocus}
            onChange={(e) => setTerm(e.target.value)}
            placeholder={placeholder}
            aria-label="Recherche client ou véhicule"
            className="w-full rounded-xl border-2 border-border bg-card py-4 pl-11 pr-10 text-base outline-none focus:border-brand"
          />
        </div>
        {onScan ? (
          <>
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              disabled={scanning}
              aria-label="Scanner la plaque"
              className="flex w-16 shrink-0 items-center justify-center rounded-xl border-2 border-border bg-card disabled:opacity-60"
            >
              {scanning ? <Loader2 className="h-6 w-6 animate-spin" /> : <Camera className="h-6 w-6" />}
            </button>
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              capture="environment"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) onScan(f);
                e.target.value = "";
              }}
            />
          </>
        ) : null}
      </div>

      {empty ? (
        <div className="space-y-2 rounded-xl border-2 border-dashed border-border p-3 text-center">
          <p className="text-sm text-muted-foreground">Aucun résultat pour « {term.trim()} ».</p>
          {onCreateNew ? (
            <button
              type="button"
              onClick={() => onCreateNew(term.trim())}
              className="inline-flex items-center gap-2 rounded-lg bg-brand px-4 py-3 text-sm font-extrabold uppercase text-brand-foreground"
            >
              <Plus className="h-4 w-4" /> Créer nouveau client / véhicule
            </button>
          ) : null}
        </div>
      ) : null}

      {res?.vehicles.length ? (
        <section className="space-y-2">
          <h3 className="px-1 text-xs font-bold uppercase tracking-wide text-muted-foreground">Véhicules</h3>
          {res.vehicles.map((v) => (
            <button
              key={v.id}
              type="button"
              onClick={() => void pickVehicle(v.id)}
              className="flex w-full items-center gap-3 rounded-xl border-2 border-border bg-card px-3 py-3 text-left active:scale-[0.99]"
            >
              <div className="min-w-0 flex-1">
                <div className="truncate text-base font-extrabold">{v.registration_display ?? "—"}</div>
                <div className="truncate text-xs text-muted-foreground">
                  {vehicleLabel(v)}
                  {v.customer ? ` · ${customerName(v.customer)}` : ""}
                </div>
              </div>
            </button>
          ))}
        </section>
      ) : null}

      {res?.customers.length ? (
        <section className="space-y-2">
          <h3 className="px-1 text-xs font-bold uppercase tracking-wide text-muted-foreground">Clients</h3>
          {res.customers.map((c) => (
            <div key={c.id} className="rounded-xl border-2 border-border bg-card px-3 py-2">
              <div className="text-base font-bold">{customerName(c)}</div>
              <div className="truncate text-xs text-muted-foreground">
                {[c.city, c.phone].filter(Boolean).join(" · ") || "—"}
              </div>
              {c.vehicles.map((v) => (
                <button
                  key={v.id}
                  type="button"
                  onClick={() => void pickVehicle(v.id)}
                  className="mt-1 flex w-full items-center gap-2 rounded-lg border border-border px-2 py-2 text-left text-sm"
                >
                  <span className="font-bold">{v.registration_display ?? "—"}</span>
                  <span className="truncate text-muted-foreground">{vehicleLabel(v)}</span>
                </button>
              ))}
            </div>
          ))}
        </section>
      ) : null}

      {res?.orders.length ? (
        <section className="space-y-2">
          <h3 className="px-1 text-xs font-bold uppercase tracking-wide text-muted-foreground">Ordres de réparation</h3>
          {res.orders.map((o) => (
            <button
              key={o.id}
              type="button"
              onClick={() => {
                if (o.plate) void searchPlatePick(o.plate, o.id, onPick);
              }}
              className="flex w-full items-center justify-between rounded-xl border-2 border-border bg-card px-3 py-3"
            >
              <span className="font-bold">OR {o.or_number ?? "—"}</span>
              <span className="text-xs text-muted-foreground">{o.plate ?? ""}</span>
            </button>
          ))}
        </section>
      ) : null}
    </div>
  );
}

async function searchPlatePick(plate: string, orderId: string, onPick: (p: EntityPick) => void) {
  const { refPrefill } = await import("@/lib/refbase");
  const p = await refPrefill(plate);
  if (p) onPick({ ...p, orderId });
}
