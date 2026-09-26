import { useQuery } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { Link } from "@tanstack/react-router";

import { useAuth } from "@/lib/auth";
import { useSite } from "@/lib/site-context";
import { listSuppliers } from "@/lib/suppliers";
import { actionSiteId, findOrByNumber, findOrsByPlate, type OrLite } from "@/lib/parts";
import { GROUP_LABEL } from "@/lib/sites";

export const inputCls = "h-11 w-full rounded-lg border-2 border-border bg-card px-3 text-sm";
export const btnPrimary = "h-11 rounded-lg bg-brand px-4 text-sm font-extrabold uppercase text-brand-foreground disabled:opacity-50";
export const btnGhost = "h-11 rounded-lg border-2 border-border bg-card px-4 text-sm font-bold uppercase disabled:opacity-50";

/** Contexte d'action : acteur + site d'écriture (défaut utilisateur) + sites pour l'affichage. */
export function usePartsCtx() {
  const { user, displayName, profile } = useAuth();
  const { sites, active, isGroup } = useSite();
  const writeSite = actionSiteId((profile?.site_id as string | null) ?? null, active, isGroup);
  const siteName = (id: string | null | undefined) => sites.find((s) => s.id === id)?.name ?? "Site non renseigné";
  return { actor: { userId: user?.id ?? null, name: displayName }, writeSite, sites, siteName };
}

export function SiteFilter({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const { sites } = useSite();
  return (
    <select className={inputCls} value={value} onChange={(e) => onChange(e.target.value)} aria-label="Périmètre">
      <option value="groupe">{GROUP_LABEL} (groupe)</option>
      {sites.map((s) => (
        <option key={s.id} value={s.id}>
          {s.name}
        </option>
      ))}
    </select>
  );
}

export function WriteSiteSelect({ value, onChange }: { value: string | null; onChange: (v: string) => void }) {
  const { sites } = useSite();
  return (
    <label className="block space-y-1">
      <span className="text-xs font-bold uppercase text-muted-foreground">Site / société (écriture)</span>
      <select className={inputCls} value={value ?? ""} onChange={(e) => onChange(e.target.value)}>
        <option value="">— Choisir le site —</option>
        {sites.map((s) => (
          <option key={s.id} value={s.id}>
            {s.name}
          </option>
        ))}
      </select>
    </label>
  );
}

export function useSuppliers() {
  return useQuery({ queryKey: ["suppliers-list"], queryFn: listSuppliers, staleTime: 300000 });
}

export function SupplierSelect({ value, onChange, required }: { value: string; onChange: (v: string) => void; required?: boolean }) {
  const q = useSuppliers();
  return (
    <select className={inputCls} value={value} onChange={(e) => onChange(e.target.value)} required={required}>
      <option value="">— Fournisseur{required ? " *" : ""} —</option>
      {(q.data ?? []).filter((s) => s.active !== false).map((s) => (
        <option key={s.id} value={s.id}>
          {s.name}
        </option>
      ))}
    </select>
  );
}

/** Rattachement OR WinMotor existant (par n°) ou par immatriculation. Ne crée jamais de n° d'OR. */
export function OrPicker({ value, onChange }: { value: { or: OrLite | null; plate: string; vehicleId: string | null }; onChange: (v: { or: OrLite | null; plate: string; vehicleId: string | null }) => void }) {
  const [num, setNum] = useState(value.or?.or_number ?? "");
  const [msg, setMsg] = useState<string | null>(null);
  const [cands, setCands] = useState<OrLite[]>([]);
  async function lookupNum() {
    setMsg(null);
    const o = await findOrByNumber(num);
    if (o) onChange({ or: o, plate: o.plate ?? value.plate, vehicleId: o.vehicle_id });
    else setMsg("OR inconnu dans DDA (non importé de WinMotor). Rattachez par immatriculation ou laissez en attente.");
  }
  async function lookupPlate() {
    setMsg(null);
    const r = await findOrsByPlate(value.plate);
    setCands(r.ors);
    onChange({ ...value, vehicleId: r.vehicleId });
    if (!r.vehicleId) setMsg("Véhicule inconnu — l'immatriculation sera gardée telle quelle.");
    else if (!r.ors.length) setMsg("Aucun OR WinMotor connu pour ce véhicule — dossier en attente OR.");
  }
  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        <input className={inputCls} placeholder="N° OR WinMotor" value={num} onChange={(e) => setNum(e.target.value)} inputMode="numeric" />
        <button type="button" className={btnGhost} onClick={lookupNum} disabled={!num.trim()}>
          OK
        </button>
      </div>
      <div className="flex gap-2">
        <input className={inputCls} placeholder="Immatriculation" value={value.plate} onChange={(e) => onChange({ ...value, plate: e.target.value })} />
        <button type="button" className={btnGhost} onClick={lookupPlate} disabled={!value.plate.trim()}>
          Chercher
        </button>
      </div>
      {cands.length ? (
        <div className="flex flex-wrap gap-2">
          {cands.map((c) => (
            <button key={c.id} type="button" className={`rounded-full border-2 px-3 py-1 text-xs font-bold ${value.or?.id === c.id ? "border-brand bg-brand text-brand-foreground" : "border-border"}`} onClick={() => { setNum(c.or_number ?? ""); onChange({ or: c, plate: value.plate, vehicleId: c.vehicle_id }); }}>
              OR {c.or_number}
            </button>
          ))}
        </div>
      ) : null}
      {value.or ? (
        <p className="text-xs font-bold">
          Rattaché : OR {value.or.or_number}
          {value.or.plate ? ` · ${value.or.plate}` : ""}{" "}
          <button type="button" className="underline" onClick={() => { onChange({ ...value, or: null }); setNum(""); }}>
            retirer
          </button>
        </p>
      ) : null}
      {msg ? <p className="text-xs text-muted-foreground">{msg}</p> : null}
    </div>
  );
}

export function Badge({ tone = "muted", children }: { tone?: "ok" | "warn" | "bad" | "muted" | "brand"; children: ReactNode }) {
  const cls = {
    ok: "bg-status-ok-soft text-foreground border-status-ok",
    warn: "bg-status-watch-soft text-foreground border-status-watch",
    bad: "bg-destructive/10 text-destructive border-destructive",
    muted: "bg-secondary text-muted-foreground border-border",
    brand: "bg-brand text-brand-foreground border-brand",
  }[tone];
  return <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase ${cls}`}>{children}</span>;
}

export const ORDER_STATUS: Record<string, { label: string; tone: "ok" | "warn" | "muted" | "bad" }> = {
  ordered: { label: "Commandée", tone: "muted" },
  partial: { label: "Partielle — reliquat", tone: "warn" },
  received: { label: "Reçue", tone: "ok" },
  cancelled: { label: "Annulée", tone: "bad" },
};

export function OrLink({ id, num }: { id: string | null; num: string | null | undefined }) {
  if (!id) return null;
  return (
    <Link to="/or/$orId" params={{ orId: id }} className="font-bold underline">
      OR {num ?? "—"}
    </Link>
  );
}

export function numOrNull(v: string): number | null {
  const n = Number(v.replace(",", "."));
  return v.trim() === "" || Number.isNaN(n) ? null : n;
}

export function fmtEur(n: number | null | undefined) {
  return n == null ? "—" : `${Number(n).toFixed(2)} €`;
}

export function ageDays(iso: string) {
  return Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 86400000));
}
