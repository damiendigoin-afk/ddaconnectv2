/** Encart « Client / véhicule » du dossier carrosserie : liens vers les fiches, création / rattachement sur clic. */
import { Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Car, Link2, Loader2, Plus, User } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { logEvent } from "@/lib/bodyshop";
import {
  attachExisting,
  createCustomerForCase,
  createVehicleForCase,
  customerDraftFromCase,
  findCustomerCandidates,
  findVehicleCandidates,
  linkErrorMessage,
  vehicleDraftFromCase,
  type CaseLinkSource,
  type CustomerDraft,
  type Match,
  type VehicleDraft,
} from "@/lib/bodyshop-link";
import { customerName, vehicleLabel } from "@/lib/refbase";

const db = supabase as never;

export function CaseRefLinks({ row, onChanged }: { row: CaseLinkSource; onChanged: () => void }) {
  const [open, setOpen] = useState<null | "customer" | "vehicle">(null);
  const cust = useQuery({
    queryKey: ["case-ref-cust", row.customer_id],
    enabled: !!row.customer_id,
    queryFn: async () => (await supabase.from("customers").select("id, first_name, last_name, company_name").eq("id", row.customer_id!).maybeSingle()).data,
  });
  const veh = useQuery({
    queryKey: ["case-ref-veh", row.ref_vehicle_id],
    enabled: !!row.ref_vehicle_id,
    queryFn: async () =>
      (await supabase.from("ref_vehicles").select("id, registration_display, brand, model, range_name, version").eq("id", row.ref_vehicle_id!).maybeSingle()).data,
  });

  return (
    <section className="card-surface space-y-2 p-3" aria-label="Client / véhicule">
      <h2 className="text-xs font-bold uppercase text-muted-foreground">Client / véhicule</h2>
      <div className="grid gap-2 sm:grid-cols-2">
        {row.customer_id ? (
          <Link to="/client/$clientId" params={{ clientId: row.customer_id }} className="flex items-center gap-2 rounded-lg border-2 border-border px-3 py-2 text-sm">
            <User className="h-4 w-4 shrink-0 text-brand" />
            <span className="min-w-0 flex-1 truncate font-bold">{cust.data ? customerName(cust.data) : "Fiche client"}</span>
            <span className="text-[11px] font-bold uppercase text-brand">Ouvrir</span>
          </Link>
        ) : (
          <button onClick={() => setOpen(open === "customer" ? null : "customer")} className="flex items-center gap-2 rounded-lg border-2 border-dashed border-border px-3 py-2 text-left text-sm">
            <User className="h-4 w-4 shrink-0 text-muted-foreground" />
            <span className="min-w-0 flex-1">
              <span className="block text-[11px] font-bold uppercase text-muted-foreground">Aucune fiche client liée</span>
              <span className="font-bold">Créer / rattacher la fiche client</span>
            </span>
          </button>
        )}
        {row.ref_vehicle_id ? (
          <Link to="/vehicule/$vehId" params={{ vehId: row.ref_vehicle_id }} className="flex items-center gap-2 rounded-lg border-2 border-border px-3 py-2 text-sm">
            <Car className="h-4 w-4 shrink-0 text-brand" />
            <span className="min-w-0 flex-1 truncate font-bold">{veh.data ? `${veh.data.registration_display ?? ""} ${vehicleLabel(veh.data)}` : "Fiche véhicule"}</span>
            <span className="text-[11px] font-bold uppercase text-brand">Ouvrir</span>
          </Link>
        ) : (
          <button onClick={() => setOpen(open === "vehicle" ? null : "vehicle")} className="flex items-center gap-2 rounded-lg border-2 border-dashed border-border px-3 py-2 text-left text-sm">
            <Car className="h-4 w-4 shrink-0 text-muted-foreground" />
            <span className="min-w-0 flex-1">
              <span className="block text-[11px] font-bold uppercase text-muted-foreground">Aucune fiche véhicule liée</span>
              <span className="font-bold">Créer / rattacher la fiche véhicule</span>
            </span>
          </button>
        )}
      </div>
      {open === "vehicle" && !row.ref_vehicle_id ? <VehiclePanel row={row} onDone={() => { setOpen(null); onChanged(); }} /> : null}
      {open === "customer" && !row.customer_id ? <CustomerPanel row={row} onDone={() => { setOpen(null); onChanged(); }} /> : null}
    </section>
  );
}

function MatchList<T extends { id: string }>({ items, label, busy, onAttach }: { items: Match<T>[]; label: (c: T) => string; busy: boolean; onAttach: (id: string) => void }) {
  if (!items.length) return <p className="text-xs text-muted-foreground">Aucune fiche existante correspondante.</p>;
  return (
    <ul className="space-y-1">
      {items.map((m) => (
        <li key={m.candidate.id} className={`flex items-center gap-2 rounded-lg border-2 px-2 py-2 text-sm ${m.certain ? "border-brand" : "border-border"}`}>
          <div className="min-w-0 flex-1">
            <div className="truncate font-bold">{label(m.candidate)}</div>
            <div className="text-[11px] text-muted-foreground">
              {m.certain ? "Correspondance certaine · " : "À vérifier · "}
              {m.reasons.join(", ")}
              {m.conflicts.length ? <span className="font-bold text-destructive"> · {m.conflicts.join(", ")}</span> : null}
            </div>
          </div>
          <button disabled={busy} onClick={() => onAttach(m.candidate.id)} className="flex shrink-0 items-center gap-1 rounded-lg border-2 border-border px-2 py-1 text-[11px] font-bold uppercase disabled:opacity-50">
            <Link2 className="h-3 w-3" /> Rattacher
          </button>
        </li>
      ))}
    </ul>
  );
}

function Inp({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <label className="block text-[11px] uppercase text-muted-foreground">
      {label}
      <input value={value} onChange={(e) => onChange(e.target.value)} placeholder="—" className="mt-0.5 w-full rounded-lg border-2 border-border bg-card px-2 py-1.5 text-sm normal-case text-foreground" />
    </label>
  );
}

function VehiclePanel({ row, onDone }: { row: CaseLinkSource; onDone: () => void }) {
  const qc = useQueryClient();
  const [d, setD] = useState<VehicleDraft>(() => vehicleDraftFromCase(row));
  const [busy, setBusy] = useState(false);
  const cands = useQuery({ queryKey: ["case-veh-cands", row.id, d.registration, d.vin], queryFn: () => findVehicleCandidates(db, d) });

  async function run(fn: () => Promise<unknown>, ok: string) {
    if (busy) return;
    setBusy(true);
    try {
      await fn();
      await logEvent({ caseId: row.id, kind: "maj", label: ok });
      void qc.invalidateQueries({ queryKey: ["case-ref-veh"] });
      toast.success(ok);
      onDone();
    } catch (e) {
      toast.error(linkErrorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  const hasAny = (cands.data ?? []).length > 0;
  return (
    <div className="space-y-2 rounded-lg border-2 border-border p-2">
      <p className="text-xs font-bold uppercase text-muted-foreground">Fiches véhicule existantes (immat / VIN)</p>
      {cands.isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : (
        <MatchList items={cands.data ?? []} busy={busy} label={(c) => `${c.registration_normalized ?? "—"} · ${[c.brand, c.range_name || c.model].filter(Boolean).join(" ") || "—"}`} onAttach={(id) => void run(() => attachExisting(db, row, "vehicle", id), "Fiche véhicule rattachée")} />
      )}
      {!hasAny && !cands.isLoading ? (
        <>
          <p className="text-xs font-bold uppercase text-muted-foreground">Nouvelle fiche (valeurs du dossier, modifiables)</p>
          <div className="grid grid-cols-2 gap-2">
            <Inp label="Immatriculation" value={d.registration} onChange={(v) => setD({ ...d, registration: v.toUpperCase().replace(/[^A-Z0-9]/g, "") })} />
            <Inp label="VIN" value={d.vin} onChange={(v) => setD({ ...d, vin: v.toUpperCase().replace(/[^A-Z0-9]/g, "") })} />
            <Inp label="Marque" value={d.brand} onChange={(v) => setD({ ...d, brand: v })} />
            <Inp label="Modèle" value={d.model} onChange={(v) => setD({ ...d, model: v })} />
          </div>
          <button disabled={busy} onClick={() => void run(() => createVehicleForCase(db, row, d), "Fiche véhicule créée et liée")} className="flex w-full items-center justify-center gap-2 rounded-lg bg-brand px-3 py-2 text-sm font-bold text-brand-foreground disabled:opacity-50">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />} Créer la fiche véhicule
          </button>
        </>
      ) : null}
    </div>
  );
}

function CustomerPanel({ row, onDone }: { row: CaseLinkSource; onDone: () => void }) {
  const qc = useQueryClient();
  const [d, setD] = useState<CustomerDraft>(() => customerDraftFromCase(row));
  const [busy, setBusy] = useState(false);
  const cands = useQuery({
    queryKey: ["case-cust-cands", row.id, d.account, d.last_name, d.first_name, d.mobile, d.phone, d.email, row.ref_vehicle_id],
    queryFn: () => findCustomerCandidates(db, d, row.site_id, row.ref_vehicle_id),
  });
  const set = (k: keyof CustomerDraft) => (v: string) => setD({ ...d, [k]: v });

  async function run(fn: () => Promise<unknown>, ok: string) {
    if (busy) return;
    setBusy(true);
    try {
      await fn();
      await logEvent({ caseId: row.id, kind: "maj", label: ok });
      void qc.invalidateQueries({ queryKey: ["case-ref-cust"] });
      toast.success(ok);
      onDone();
    } catch (e) {
      toast.error(linkErrorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  const certain = (cands.data ?? []).some((m) => m.certain);
  return (
    <div className="space-y-2 rounded-lg border-2 border-border p-2">
      <p className="text-xs font-bold uppercase text-muted-foreground">Fiches client existantes (compte, nom, coordonnées)</p>
      {cands.isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : (
        <MatchList items={cands.data ?? []} busy={busy} label={(c) => `${customerName(c)}${c.source_customer_id ? ` · n° ${c.source_customer_id}` : ""}`} onAttach={(id) => void run(() => attachExisting(db, row, "customer", id), "Fiche client rattachée")} />
      )}
      {!certain && !cands.isLoading ? (
        <>
          <p className="text-xs font-bold uppercase text-muted-foreground">Nouvelle fiche (valeurs du dossier, à compléter si vide)</p>
          <div className="grid grid-cols-2 gap-2">
            <Inp label="Civilité" value={d.civility} onChange={set("civility")} />
            <Inp label="N° compte WinMotor" value={d.account} onChange={set("account")} />
            <Inp label="Nom" value={d.last_name} onChange={set("last_name")} />
            <Inp label="Prénom" value={d.first_name} onChange={set("first_name")} />
            <Inp label="Société" value={d.company_name} onChange={(v) => setD({ ...d, company_name: v, customer_type: v ? "company" : "individual" })} />
            <Inp label="Mobile" value={d.mobile} onChange={set("mobile")} />
            <Inp label="Téléphone fixe" value={d.phone} onChange={set("phone")} />
            <Inp label="E-mail" value={d.email} onChange={set("email")} />
            <Inp label="Adresse" value={d.address_line_1} onChange={set("address_line_1")} />
            <div className="grid grid-cols-[5rem_1fr] gap-2">
              <Inp label="CP" value={d.postal_code} onChange={set("postal_code")} />
              <Inp label="Ville" value={d.city} onChange={set("city")} />
            </div>
          </div>
          <button disabled={busy} onClick={() => void run(() => createCustomerForCase(db, row, d), "Fiche client créée et liée")} className="flex w-full items-center justify-center gap-2 rounded-lg bg-brand px-3 py-2 text-sm font-bold text-brand-foreground disabled:opacity-50">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />} Créer la fiche client
          </button>
        </>
      ) : null}
    </div>
  );
}
