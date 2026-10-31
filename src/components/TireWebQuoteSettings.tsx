import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { getDistricashStatus } from "@/lib/districash.functions";
import { SEASON_LABEL, TIER_LABEL } from "@/lib/tires";
import {
  WEB_QUOTE_CASES,
  WEB_SUPPLIERS,
  canActivateWeb,
  webConnectionState,
  webSupplierKey,
} from "@/lib/tire-web-quote";

/** Bloc administrateur « Devis pneus — Site web » (configuration seule, activation bloquée). */
export function TireWebQuoteSettings() {
  const districashStatus = useServerFn(getDistricashStatus);
  const q = useQuery({
    queryKey: ["tire-web-quote-settings"],
    queryFn: async () => {
      const [cfg, sites, cs] = await Promise.all([
        supabase
          .from("tire_web_quote_settings")
          .select("web_supplier, site_id, enabled, updated_at")
          .maybeSingle(),
        supabase.from("sites").select("id, name, code").eq("active", true).order("name"),
        supabase
          .from("commercial_settings")
          .select("tire_provider_status, tire_provider_last_ok_at, tire_provider_message")
          .limit(1)
          .maybeSingle(),
      ]);
      if (cfg.error) throw cfg.error;
      if (sites.error) throw sites.error;
      if (cs.error) throw cs.error;
      return { cfg: cfg.data, sites: sites.data ?? [], centrale: cs.data };
    },
  });
  const dc = useQuery({ queryKey: ["districash-status"], queryFn: () => districashStatus() });

  const [supplier, setSupplier] = useState("");
  const [siteId, setSiteId] = useState("");
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  // Initialisation contrôlée : un refetch ne remplace jamais une saisie en cours.
  useEffect(() => {
    if (!q.data || dirty) return;
    setSupplier(webSupplierKey(q.data.cfg?.web_supplier) ?? "");
    setSiteId(q.data.cfg?.site_id ?? "");
  }, [q.data, dirty]);
  const loaded = q.isSuccess && !!q.data;

  const sKey = webSupplierKey(supplier);
  const dSite = (dc.data ?? []).find((s) => s.siteId === siteId);
  const conn = webConnectionState({
    supplier: sKey,
    siteId: siteId || null,
    centrale: q.data?.centrale
      ? {
          status: q.data.centrale.tire_provider_status,
          lastOkAt: q.data.centrale.tire_provider_last_ok_at,
          message: q.data.centrale.tire_provider_message,
        }
      : null,
    districashError: dc.isError,
    districash: dSite
      ? { configured: dSite.configured, lastTestOk: dSite.lastTestOk, lastTestAt: dSite.lastTestAt }
      : null,
  });
  const activation = canActivateWeb();

  async function save() {
    if (!loaded || saving || !dirty) return;
    setSaving(true);
    try {
      const { data: u } = await supabase.auth.getUser();
      const { error } = await supabase.from("tire_web_quote_settings").upsert(
        {
          id: true,
          web_supplier: sKey,
          site_id: siteId || null,
          enabled: false,
          updated_by: u.user?.id ?? null,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "id" },
      );
      if (error) {
        toast.error("Enregistrement impossible.");
        return;
      }
      toast.success("Paramètres site web enregistrés");
      setDirty(false);
      await q.refetch();
    } catch {
      toast.error("Enregistrement impossible.");
    } finally {
      setSaving(false);
    }
  }

  const tone =
    conn.state === "controle_ok" || conn.state === "aucune_connexion_requise"
      ? "text-foreground"
      : conn.state === "echec" ||
          conn.state === "identifiants_absents" ||
          conn.state === "lecture_impossible"
        ? "text-destructive"
        : "text-muted-foreground";

  return (
    <section className="card-surface space-y-3 p-4">
      <h2 className="text-sm font-bold uppercase tracking-widest">Devis pneus — Site web</h2>
      <p className="text-xs text-muted-foreground">
        Réglages propres au devis du site vitrine, séparés des fournisseurs internes par site. Le
        calcul reprendra la marge, le montage et les marques actuellement communs à tous les sites ;
        seul le compte fournisseur (Districash) dépend de l&apos;établissement de rattachement. 6
        cases fixes, sans remplacement silencieux d&apos;une case vide.
      </p>
      {q.isPending ? (
        <p className="text-xs text-muted-foreground">Chargement des réglages…</p>
      ) : null}
      {q.isError ? (
        <div className="flex items-center justify-between gap-2 rounded-lg border border-destructive p-3 text-sm text-destructive">
          <span>Lecture des réglages impossible : enregistrement bloqué.</span>
          <button
            onClick={() => void q.refetch()}
            className="rounded-lg border border-border px-2 py-1 text-xs font-bold uppercase"
          >
            Réessayer
          </button>
        </div>
      ) : null}
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="text-xs font-bold uppercase tracking-widest text-muted-foreground">
          Fournisseur web
          <select
            value={supplier}
            onChange={(e) => {
              setSupplier(e.target.value);
              setDirty(true);
            }}
            disabled={!loaded || saving}
            className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm normal-case tracking-normal text-foreground"
          >
            <option value="">— Choisir —</option>
            {WEB_SUPPLIERS.map((o) => (
              <option key={o.key} value={o.key}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
        <label className="text-xs font-bold uppercase tracking-widest text-muted-foreground">
          Établissement de rattachement
          <select
            value={siteId}
            onChange={(e) => {
              setSiteId(e.target.value);
              setDirty(true);
            }}
            disabled={!loaded || saving}
            className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm normal-case tracking-normal text-foreground"
          >
            <option value="">— Choisir —</option>
            {(q.data?.sites ?? []).map((s) => (
              <option key={s.id} value={s.id}>
                {s.code === "dda" ? "Lalinde" : s.name}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="rounded-lg border border-border p-3 text-sm">
        <span className="text-xs font-bold uppercase tracking-widest text-muted-foreground">
          État de connexion :{" "}
        </span>
        <span className={tone}>{conn.label}</span>
        {dc.isError && sKey === "districash" ? (
          <button
            onClick={() => void dc.refetch()}
            className="ml-2 rounded-lg border border-border px-2 py-1 text-xs font-bold uppercase"
          >
            Réessayer
          </button>
        ) : null}
      </div>
      <div className="text-xs text-muted-foreground">
        Cases proposées :{" "}
        {WEB_QUOTE_CASES.map((c) => `${SEASON_LABEL[c.season]} ${TIER_LABEL[c.tier]}`).join(" · ")}
      </div>
      <label className="flex items-start gap-2 rounded-lg border border-dashed border-border p-3 text-sm">
        <input
          type="checkbox"
          checked={false}
          disabled
          aria-describedby="web-activation-reason"
          className="mt-1"
        />
        <span>
          <span className="font-semibold">Activer le devis sur le site web</span>
          <span id="web-activation-reason" className="block text-xs text-muted-foreground">
            {activation.reason}
          </span>
        </span>
      </label>
      <button
        onClick={() => void save()}
        disabled={!loaded || saving || !dirty}
        className="w-full disabled:opacity-50 rounded-xl bg-brand px-4 py-3 text-sm font-bold uppercase text-brand-foreground"
      >
        {saving ? "Enregistrement…" : "Enregistrer"}
      </button>
    </section>
  );
}
