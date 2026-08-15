import { Link } from "@tanstack/react-router";
import { Car, Loader2, Search, User } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { customerName, universalSearch, vehicleLabel, type SearchResult } from "@/lib/refbase";

export function UniversalSearch({ placeholder = "Immat, nom, téléphone, VIN, n° OR…" }: { placeholder?: string }) {
  const [term, setTerm] = useState("");
  const [loading, setLoading] = useState(false);
  const [res, setRes] = useState<SearchResult | null>(null);

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
    }, 250);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [term]);

  const isEmpty = useMemo(
    () => res && !res.customers.length && !res.vehicles.length && !res.orders.length,
    [res],
  );

  return (
    <div className="space-y-3">
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-muted-foreground" />
        {loading ? (
          <Loader2 className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-muted-foreground" />
        ) : null}
        <input
          value={term}
          onChange={(e) => setTerm(e.target.value)}
          placeholder={placeholder}
          aria-label="Recherche client ou véhicule"
          className="w-full rounded-xl border-2 border-border bg-card py-4 pl-11 pr-10 text-base outline-none focus:border-brand"
        />
      </div>

      {isEmpty ? <p className="px-1 text-sm text-muted-foreground">Aucun résultat.</p> : null}

      {res?.vehicles.length ? (
        <section className="space-y-2">
          <h2 className="px-1 text-xs font-bold uppercase tracking-wide text-muted-foreground">Véhicules</h2>
          {res.vehicles.map((v) => (
            <Link
              key={v.id}
              to="/vehicule/$vehId"
              params={{ vehId: v.id }}
              className="flex items-center gap-3 rounded-xl border-2 border-border bg-card px-3 py-3 active:scale-[0.99]"
            >
              <Car className="h-5 w-5 shrink-0 text-brand" />
              <div className="min-w-0 flex-1">
                <div className="truncate text-base font-extrabold">{v.registration_display ?? "—"}</div>
                <div className="truncate text-xs text-muted-foreground">
                  {vehicleLabel(v)}
                  {v.customer ? ` · ${customerName(v.customer)}` : ""}
                </div>
              </div>
              {v.last_mileage ? (
                <span className="shrink-0 text-xs font-bold">{v.last_mileage.toLocaleString("fr-FR")} km</span>
              ) : null}
            </Link>
          ))}
        </section>
      ) : null}

      {res?.customers.length ? (
        <section className="space-y-2">
          <h2 className="px-1 text-xs font-bold uppercase tracking-wide text-muted-foreground">Clients</h2>
          {res.customers.map((c) => (
            <div key={c.id} className="rounded-xl border-2 border-border bg-card">
              <Link
                to="/client/$clientId"
                params={{ clientId: c.id }}
                className="flex items-center gap-3 px-3 py-3"
              >
                <User className="h-5 w-5 shrink-0 text-brand" />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-base font-bold">{customerName(c)}</div>
                  <div className="truncate text-xs text-muted-foreground">
                    {[c.city, c.phone].filter(Boolean).join(" · ") || "—"}
                  </div>
                </div>
              </Link>
              {c.vehicles.length ? (
                <div className="border-t border-border px-3 py-2">
                  {c.vehicles.map((v) => (
                    <Link
                      key={v.id}
                      to="/vehicule/$vehId"
                      params={{ vehId: v.id }}
                      className="flex items-center gap-2 py-1.5 text-sm"
                    >
                      <span className="font-bold">{v.registration_display ?? "—"}</span>
                      <span className="truncate text-muted-foreground">{vehicleLabel(v)}</span>
                    </Link>
                  ))}
                </div>
              ) : null}
            </div>
          ))}
        </section>
      ) : null}

      {res?.orders.length ? (
        <section className="space-y-2">
          <h2 className="px-1 text-xs font-bold uppercase tracking-wide text-muted-foreground">Ordres de réparation</h2>
          {res.orders.map((o) => (
            <Link
              key={o.id}
              to="/or/$orId"
              params={{ orId: o.id }}
              className="flex items-center justify-between rounded-xl border-2 border-border bg-card px-3 py-3"
            >
              <span className="font-bold">OR {o.or_number ?? "—"}</span>
              <span className="text-xs text-muted-foreground">{o.plate ?? ""}</span>
            </Link>
          ))}
        </section>
      ) : null}
    </div>
  );
}
