import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { ChevronDown, ClipboardCheck, Car, FilePlus2, User } from "lucide-react";
import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { tireStepHistory } from "@/lib/tire-step.functions";

import { normalizeVin } from "@/lib/winmotor/mapping";
import { InvoiceTimeline } from "@/components/InvoiceTimeline";
import { AppShell } from "@/components/AppShell";
import { VehicleInlineEditor } from "@/components/VehicleInlineEditor";
import { mileageDate } from "@/lib/ref-vehicle-edit";
import { useAuth } from "@/lib/auth";
import { customerName, fetchRefVehicle, vehicleLabel } from "@/lib/refbase";
import { completenessLabel, vehicleCompleteness } from "@/lib/quality";

export const Route = createFileRoute("/vehicule/$vehId")({
  head: () => ({
    meta: [
      { title: "Fiche véhicule — DDA Connect" },
      { name: "description", content: "Immatriculation, caractéristiques, kilométrage et historique atelier d'un véhicule du référentiel DDA Connect." },
      { property: "og:title", content: "Fiche véhicule — DDA Connect" },
      { property: "og:description", content: "Caractéristiques, kilométrage et historique du véhicule." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: VehiclePage,
});

function TireStepHistory({ plate }: { plate: string }) {
  const fn = useServerFn(tireStepHistory);
  const { data } = useQuery({ queryKey: ["tire-step-history", plate], enabled: plate.length > 1, queryFn: () => fn({ data: { plate } }) });
  if (!data?.length) return null;
  const mm = (v: number | null) => (v == null ? "—" : `${v.toLocaleString("fr-FR", { minimumFractionDigits: 1 })}`);
  return (
    <section className="card-surface space-y-3 p-4">
      <h2 className="text-xs font-bold uppercase text-muted-foreground">États pneus</h2>
      {data.map((r) => (
        <div key={r.id} className="space-y-1 border-t border-border pt-2 first:border-0 first:pt-0">
          <p className="text-sm font-bold">{new Date(r.date).toLocaleDateString("fr-FR")}{r.position ? ` · ${r.position}` : ""}{r.orNumber ? ` · OR ${r.orNumber}` : ""}</p>
          <p className="text-xs text-muted-foreground">Profondeurs (mm) : {r.depth.map(mm).join(" / ")}{r.by ? ` · ${r.by}` : ""}</p>
          <div className="flex gap-2 overflow-x-auto">{r.urls.map((u) => <a key={u} href={u} target="_blank" rel="noreferrer"><img src={u} alt="Photo pneu" className="h-20 w-20 rounded object-cover" /></a>)}</div>
        </div>
      ))}
    </section>
  );
}

const fr = (d: string | null | undefined) => (d ? new Date(d).toLocaleDateString("fr-FR") : "—");

function VehiclePage() {
  const { vehId } = Route.useParams();
  const { isManager } = useAuth();
  const [full, setFull] = useState(false);
  const { data, isLoading } = useQuery({ queryKey: ["ref-vehicle", vehId], queryFn: () => fetchRefVehicle(vehId) });

  const v = data?.vehicle;
  const owner = data?.customers?.[0] ?? null;
  const plate = v?.registration_display ?? v?.registration_normalized ?? "";

  return (
    <AppShell title={plate || "Véhicule"} subtitle={v ? vehicleLabel(v) : undefined} back={{ to: "/base" }}>
      <div className="space-y-4">
        {isLoading ? <p className="text-sm text-muted-foreground">Chargement…</p> : null}
        {!isLoading && !v ? <p className="card-surface p-5 text-sm">Véhicule introuvable.</p> : null}

        {v ? (
          <>
            <VehicleInlineEditor vehicle={v} />

            <div className="rounded-xl border-2 border-border bg-card p-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-extrabold uppercase tracking-wide">Complétude de la fiche</span>
                <span className="text-sm font-extrabold">{vehicleCompleteness(v as unknown as Record<string, unknown>).score} %</span>
              </div>
              <div className="mt-2 h-2 overflow-hidden rounded-full bg-secondary">
                <div
                  className="h-full rounded-full bg-brand"
                  style={{ width: `${vehicleCompleteness(v as unknown as Record<string, unknown>).score}%` }}
                />
              </div>
              <p className="mt-2 text-[11px] text-muted-foreground">
                {completenessLabel(vehicleCompleteness(v as unknown as Record<string, unknown>))}
              </p>
            </div>

            {owner ? (
              <Link
                to="/client/$clientId"
                params={{ clientId: owner.id }}
                className="flex items-center gap-3 rounded-xl border-2 border-border bg-card px-4 py-3"
              >
                <User className="h-5 w-5 text-brand" />
                <div className="flex-1">
                  <div className="text-xs uppercase text-muted-foreground">Client</div>
                  <div className="font-bold">{customerName(owner)}</div>
                </div>
              </Link>
            ) : null}

            <div className="grid grid-cols-1 gap-2">
              <Link
                to="/or/nouveau"
                search={{ plate: plate }}
                className="flex items-center justify-center gap-2 rounded-xl bg-brand px-4 py-4 text-sm font-extrabold uppercase text-brand-foreground"
              >
                <FilePlus2 className="h-5 w-5" /> Créer une intervention
              </Link>
              <div className="grid grid-cols-2 gap-2">
                <Link
                  to="/tour-vehicule"
                  search={{ vehicle_id: vehId }}
                  className="flex items-center justify-center gap-2 rounded-xl border-2 border-border bg-card px-3 py-3 text-sm font-bold uppercase"
                >
                  <Car className="h-4 w-4" /> Tour véhicule
                </Link>
                <Link
                  to="/expertise/nouvelle"
                  search={{ vehicle_id: vehId }}
                  className="flex items-center justify-center gap-2 rounded-xl border-2 border-border bg-card px-3 py-3 text-sm font-bold uppercase"
                >
                  <ClipboardCheck className="h-4 w-4" /> Expertise
                </Link>
              </div>
            </div>

            <Section title={`Interventions (${data?.orders.length ?? 0})`}>
              {(data?.orders ?? []).map((o) => (
                <Link
                  key={o.id}
                  to="/or/$orId"
                  params={{ orId: o.id }}
                  className="flex items-center justify-between px-4 py-2 text-sm"
                >
                  <span className="font-bold">{o.or_number ? `OR WinMotor ${o.or_number}` : "Intervention DDA"}</span>
                  <span className="text-muted-foreground">{fr(o.or_date ?? o.created_at)}</span>
                </Link>
              ))}
            </Section>

            <InvoiceTimeline target={{ kind: "vehicle", id: vehId, registration_normalized: v.registration_normalized ?? null, vin_normalized: normalizeVin(v.vin ?? "") || null }} />

            <Section title={`Tours véhicule (${data?.inspections.length ?? 0})`}>
              {(data?.inspections ?? []).map((i) => (
                <Link
                  key={i.id}
                  to="/tour/$tourId"
                  params={{ tourId: i.id }}
                  className="flex items-center justify-between px-4 py-2 text-sm"
                >
                  <span className="font-bold capitalize">{i.inspection_type}</span>
                  <span className="text-muted-foreground">{fr(i.started_at)}</span>
                </Link>
              ))}
            </Section>

            <Section title={`Expertises (${data?.expertises.length ?? 0})`}>
              {(data?.expertises ?? []).map((e) => (
                <Link
                  key={e.id}
                  to="/expertise/$exId"
                  params={{ exId: e.id }}
                  className="flex items-center justify-between px-4 py-2 text-sm"
                >
                  <span className="font-bold capitalize">{e.expertise_type}</span>
                  <span className="text-muted-foreground">{fr(e.created_at)}</span>
                </Link>
              ))}
            </Section>

            <Section title={`Historique kilométrique (${data?.mileages.length ?? 0})`}>
              {(data?.mileages ?? []).map((m) => (
                <div key={m.id} className="flex items-center justify-between px-4 py-2 text-sm">
                  <span className="font-bold">{m.mileage.toLocaleString("fr-FR")} km</span>
                  <span className="text-xs text-muted-foreground">
                    {[mileageDate(m), m.source].filter(Boolean).join(" · ")}
                  </span>
                </div>
              ))}
            </Section>

            {isManager ? (
              <section className="card-surface p-4">
                <button
                  onClick={() => setFull((f) => !f)}
                  className="flex w-full items-center justify-between text-xs font-bold uppercase text-muted-foreground"
                >
                  Informations techniques complètes
                  <ChevronDown className={`h-4 w-4 transition-transform ${full ? "rotate-180" : ""}`} />
                </button>
                {full ? (
                  <dl className="mt-3 space-y-1 text-sm">
                    {Object.entries(v as Record<string, unknown>)
                      .filter(([, val]) => val !== null && val !== "" && val !== undefined)
                      .map(([k, val]) => (
                        <div key={k} className="flex justify-between gap-3">
                          <dt className="text-muted-foreground">{k}</dt>
                          <dd className="truncate font-medium">{String(val)}</dd>
                        </div>
                      ))}
                  </dl>
                ) : null}
              </section>
            ) : null}
          </>
        ) : null}
      </div>
    </AppShell>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[11px] uppercase text-muted-foreground">{label}</dt>
      <dd className="truncate font-semibold">{value}</dd>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  const has = Array.isArray(children) ? children.length > 0 : Boolean(children);
  return (
    <section className="space-y-1">
      <h2 className="px-1 text-xs font-bold uppercase text-muted-foreground">{title}</h2>
      <div className="card-surface divide-y divide-border">
        {has ? children : <p className="px-4 py-3 text-sm text-muted-foreground">Aucun élément.</p>}
      </div>
    </section>
  );
}
