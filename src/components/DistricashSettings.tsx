/** Connexion Districash — un compte indépendant par site, identifiants chiffrés côté serveur. */
import { useServerFn } from "@tanstack/react-start";
import { Plug } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { Field } from "@/components/bits";
import { DISTRICASH_STATUS_LABEL, districashStatus } from "@/lib/districash";
import {
  deleteDistricashSettings,
  getDistricashStatus,
  saveDistricashSettings,
  testDistricashConnection,
} from "@/lib/districash.functions";
import { fmtCheck, STATUS_TONE } from "@/lib/integration-status";

type SiteStatus = Awaited<ReturnType<typeof getDistricashStatus>>[number];

export function DistricashSettings() {
  const load = useServerFn(getDistricashStatus);
  const [rows, setRows] = useState<SiteStatus[] | null>(null);
  const [error, setError] = useState("");

  const refresh = () =>
    load({})
      .then(setRows)
      .catch((e) => setError(e instanceof Error ? e.message : "Chargement impossible"));
  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="rounded-xl border-2 border-dashed border-border bg-card px-4 py-4">
      <div className="flex items-center gap-3">
        <Plug className="h-6 w-6 shrink-0 text-brand" />
        <div className="flex-1">
          <div className="text-base font-extrabold uppercase tracking-wide">Connexion Districash</div>
          <div className="text-xs text-muted-foreground">Un compte portail indépendant par site.</div>
        </div>
      </div>
      <GeneralBanner rows={rows} />
      {error ? <p className="mt-3 rounded-lg bg-red-100 px-3 py-2 text-xs text-red-950">{error}</p> : null}
      <div className="mt-3 space-y-3">
        {(rows ?? []).map((r) => (
          <SiteBlock key={r.siteId} row={r} onChange={() => void refresh()} />
        ))}
      </div>
    </div>
  );
}

/** Bandeau général : reflète l'état réel de chaque site, jamais un message figé. */
function GeneralBanner({ rows }: { rows: SiteStatus[] | null }) {
  if (!rows) return null;
  const statusOf = (r: SiteStatus) =>
    districashStatus({
      configured: r.configured,
      lastCheckOk: r.lastTestOk,
      lastCheckMessage: r.lastTestMessage,
      lastCheckAt: r.lastTestAt,
    });
  const notConnected = rows.filter((r) => {
    const s = statusOf(r);
    return s !== "teste" && s !== "actif";
  });
  if (notConnected.length === 0) {
    return (
      <p className="mt-3 text-xs text-muted-foreground">
        Tous les sites sont connectés. « Tester la connexion » ouvre une session lecture seule et recherche des
        245/45 R20 : « Connecté » seulement si des pneus avec EAN et prix sont lus. Aucune commande.
      </p>
    );
  }
  return (
    <p className="mt-3 rounded-lg bg-amber-100 px-3 py-2 text-xs text-amber-950">
      {notConnected
        .map((r) => `${r.siteName} : ${DISTRICASH_STATUS_LABEL[statusOf(r)].toLowerCase()}`)
        .join(" — ")}
      . Seuls les sites « Connecté » alimentent les devis pneus.
    </p>
  );
}

function SiteBlock({ row, onChange }: { row: SiteStatus; onChange: () => void }) {
  const save = useServerFn(saveDistricashSettings);
  const remove = useServerFn(deleteDistricashSettings);
  const test = useServerFn(testDistricashConnection);
  const [editing, setEditing] = useState(false);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

  const status = districashStatus({
    configured: row.configured,
    lastCheckOk: row.lastTestOk,
    lastCheckMessage: row.lastTestMessage,
    lastCheckAt: row.lastTestAt,
  });

  async function run(fn: () => Promise<unknown>, ok?: string) {
    setBusy(true);
    try {
      await fn();
      if (ok) toast.success(ok);
      onChange();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Action impossible");
    } finally {
      setBusy(false);
      setPassword("");
    }
  }

  return (
    <section className="space-y-2 rounded-lg border border-border p-3 text-xs">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-sm font-extrabold uppercase">
          {row.siteName}
          {row.account ? <span className="ml-2 text-muted-foreground">compte {row.account}</span> : null}
        </div>
        <span className={`rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase ${STATUS_TONE[status]}`}>
          {DISTRICASH_STATUS_LABEL[status]}
        </span>
      </div>
      <p className="text-muted-foreground">
        Dernier test : {fmtCheck(row.lastTestAt)}
        {row.lastTestMessage ? ` — ${row.lastTestMessage}` : ""}
      </p>
      {editing || !row.configured ? (
        <div className="space-y-2">
          <Field label="Utilisateur portail" value={username} onChange={setUsername} />
          <Field label="Mot de passe portail" value={password} onChange={setPassword} type="password" />
          <div className="flex gap-2">
            <button
              disabled={busy || !username || !password}
              onClick={() =>
                void run(async () => {
                  await save({ data: { siteId: row.siteId, username, password } });
                  setEditing(false);
                  setUsername("");
                }, "Identifiants enregistrés (chiffrés)")
              }
              className="rounded-lg bg-brand px-3 py-2 font-extrabold uppercase text-brand-foreground disabled:opacity-60"
            >
              Enregistrer
            </button>
            {row.configured ? (
              <button onClick={() => setEditing(false)} className="rounded-lg border-2 border-border px-3 py-2 font-extrabold uppercase">
                Annuler
              </button>
            ) : null}
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          <button onClick={() => setEditing(true)} className="rounded-lg border-2 border-border px-3 py-2 font-extrabold uppercase">
            Modifier les identifiants
          </button>
          <button
            disabled={busy}
            onClick={() =>
              void run(async () => {
                const r = await test({ data: { siteId: row.siteId } });
                if (r.ok === false) toast.error(r.message);
                else toast.info(r.message);
              })
            }
            className="rounded-lg bg-brand px-3 py-2 font-extrabold uppercase text-brand-foreground disabled:opacity-60"
          >
            {busy ? "Test…" : "Tester la connexion"}
          </button>
          <button
            disabled={busy}
            onClick={() => {
              if (window.confirm("Supprimer les identifiants Districash de ce site ?"))
                void run(() => remove({ data: { siteId: row.siteId } }), "Identifiants supprimés");
            }}
            className="rounded-lg border-2 border-border px-3 py-2 font-extrabold uppercase"
          >
            Supprimer
          </button>
        </div>
      )}
    </section>
  );
}
