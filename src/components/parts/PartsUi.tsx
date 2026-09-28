import { useQuery } from "@tanstack/react-query";
import { useEffect, useState, type ReactNode } from "react";
import { Link } from "@tanstack/react-router";

import { useAuth } from "@/lib/auth";
import { useSite } from "@/lib/site-context";
import { listSuppliers } from "@/lib/suppliers";
import { findOrByNumber, findOrsByPlate, type OrLite } from "@/lib/parts";
import { GROUP_LABEL } from "@/lib/sites";
import { partsReadSite, partsWriteSite } from "@/lib/parts-site";
import { syncOrNumber } from "@/lib/receipt-lines";
import { formatPlate } from "@/lib/plate";

export const inputCls = "h-11 w-full rounded-lg border-2 border-border bg-card px-3 text-sm";
export const btnPrimary = "h-11 rounded-lg bg-brand px-4 text-sm font-extrabold uppercase text-brand-foreground disabled:opacity-50";
export const btnGhost = "h-11 rounded-lg border-2 border-border bg-card px-4 text-sm font-bold uppercase disabled:opacity-50";

/**
 * Contexte d'action : acteur + site actif global (écriture) + périmètre de lecture.
 * Toutes les pages Pièces & achats héritent du site choisi dans la barre haute.
 */
export function usePartsCtx() {
  const { user, displayName, profile } = useAuth();
  const { sites, active, isGroup, label } = useSite();
  const writeSite = partsWriteSite(active, isGroup, (profile?.site_id as string | null) ?? null);
  const readSite = partsReadSite(active, isGroup);
  const siteName = (id: string | null | undefined) => sites.find((s) => s.id === id)?.name ?? "Site non renseigné";
  return { actor: { userId: user?.id ?? null, name: displayName }, writeSite, readSite, isGroup, activeLabel: label, sites, siteName };
}

/** Rappel discret du site actif ; en vue groupe, précise où les créations seront écrites. */
export function ActiveSiteNote() {
  const { isGroup, activeLabel, writeSite, siteName } = usePartsCtx();
  return (
    <p className="text-xs text-muted-foreground" data-testid="parts-site-note">
      {isGroup
        ? writeSite
          ? `Vue groupe : consultation des deux sites. Les créations seront faites sur ${siteName(writeSite)}.`
          : "Vue groupe : choisissez un site dans la barre du haut pour créer."
        : `Site actif : ${activeLabel} — modifiable dans la barre du haut.`}
    </p>
  );
}

/** Alerte non bloquante : le document semble appartenir à un autre site. */
export function SiteMismatchAlert({ docSite }: { docSite: string | null }) {
  const { writeSite, siteName } = usePartsCtx();
  const { setActive } = useSite();
  if (!docSite || !writeSite || docSite === writeSite) return null;
  return (
    <div className="rounded-lg border-2 border-status-watch bg-status-watch-soft p-3 text-xs" role="alert">
      <p className="font-bold">Ce document semble appartenir à {siteName(docSite)}.</p>
      <p>Rien n'a été changé : l'enregistrement se fera sur {siteName(writeSite)} sauf si vous basculez.</p>
      <button type="button" className="mt-1 font-extrabold underline" onClick={() => setActive(docSite)}>
        Basculer sur {siteName(docSite)}
      </button>
    </div>
  );
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
export function OrPicker({ value, onChange, initialNumber, onNumberChange }: { value: { or: OrLite | null; plate: string; vehicleId: string | null }; onChange: (v: { or: OrLite | null; plate: string; vehicleId: string | null }) => void; initialNumber?: string | null; onNumberChange?: (n: string) => void }) {
  const [num, setNumRaw] = useState(value.or?.or_number ?? initialNumber ?? "");
  const [touched, setTouched] = useState(false);
  const setNum = (v: string) => { setNumRaw(v); onNumberChange?.(v); };
  useEffect(() => {
    const next = syncOrNumber(num, touched, value.or?.or_number ?? initialNumber);
    if (next !== num) setNum(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialNumber, value.or?.or_number, touched]);
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
    const pretty = formatPlate(value.plate);
    const r = await findOrsByPlate(value.plate);
    setCands(r.ors);
    onChange({ ...value, plate: pretty, vehicleId: r.vehicleId });
    const last = r.wmHistory[0];
    const hist = last ? ` Dernier OR historique (historique uniquement, jamais rattaché) : ${last.or_number} du ${new Date(last.date).toLocaleDateString("fr-FR")}.` : "";
    if (!r.ors.length && r.wmHistory.length) setMsg(`Immatriculation connue dans l'historique WinMotor — aucun OR DDA actuel rattaché. Vous pouvez valider le BL et rattacher l'OR plus tard.${hist}`);
    else if (!r.vehicleId) setMsg("Véhicule inconnu — l'immatriculation sera gardée telle quelle. Vous pouvez valider le BL.");
    else if (!r.ors.length) setMsg("Aucun OR WinMotor connu pour ce véhicule — vous pouvez valider le BL et rattacher l'OR plus tard.");
  }
  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        <input className={inputCls} placeholder="N° dossier / OR WinMotor" aria-label="N° dossier / OR WinMotor" value={num} onChange={(e) => { setTouched(true); setNum(e.target.value); }} inputMode="numeric" />
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
          <button type="button" className="underline" onClick={() => { onChange({ ...value, or: null }); }}>
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
