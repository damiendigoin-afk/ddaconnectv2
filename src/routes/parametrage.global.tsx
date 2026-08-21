import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { Building2, ChevronRight, Euro, MessageSquareText, Plug, Truck } from "lucide-react";
import { useEffect, useState } from "react";

import { AppShell } from "@/components/AppShell";
import { Field } from "@/components/bits";
import { getIxellioSettings, saveIxellioSettings, testIxellioAuth } from "@/lib/ixellio.functions";

import { useAuth } from "@/lib/auth";

export const Route = createFileRoute("/parametrage/global")({
  head: () => ({
    meta: [
      { title: "Paramétrage global — DDA Connect" },
      {
        name: "description",
        content:
          "Référentiels partagés DDA Connect : fournisseurs et contacts, assurances et experts, modèles de messages administrables.",
      },
      { property: "og:title", content: "Paramétrage global — DDA Connect" },
      { property: "og:description", content: "Fournisseurs, contacts, référentiels et modèles de messages." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: GlobalSettings,
});

type TestResult = Awaited<ReturnType<typeof testIxellioAuth>>;

const OUTCOME_TONE: Record<string, string> = {
  auth_ok_vehicle_found: "bg-emerald-100 text-emerald-950",
  auth_ok_no_vehicle: "bg-emerald-100 text-emerald-950",
  auth_refused: "bg-red-100 text-red-950",
  redirect_to_login: "bg-amber-100 text-amber-950",
  network_error: "bg-red-100 text-red-950",
  unexpected_response: "bg-amber-100 text-amber-950",
};

const OUTCOME_LABEL: Record<string, string> = {
  auth_ok_vehicle_found: "Connexion réussie · véhicule trouvé",
  auth_ok_no_vehicle: "Connexion réussie · aucun véhicule",
  auth_refused: "Identifiants refusés",
  redirect_to_login: "Redirection vers la page de connexion",
  network_error: "Erreur réseau",
  unexpected_response: "Réponse inattendue",
};

function IxellioSettings() {
  const run = useServerFn(testIxellioAuth);
  const loadStatus = useServerFn(getIxellioSettings);
  const saveCreds = useServerFn(saveIxellioSettings);

  const [status, setStatus] = useState<{ configured: boolean; updatedAt: string | null } | null>(null);
  const [editing, setEditing] = useState(false);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [plate, setPlate] = useState("AA123AA");
  const [loading, setLoading] = useState(false);
  const [savingCreds, setSavingCreds] = useState(false);
  const [result, setResult] = useState<TestResult | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    void loadStatus({}).then(setStatus).catch(() => setStatus({ configured: false, updatedAt: null }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function saveCredentials() {
    setSavingCreds(true);
    setError("");
    try {
      const next = await saveCreds({ data: { username, password } });
      setStatus(next);
      setEditing(false);
      setUsername("");
      setPassword("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Enregistrement impossible");
    } finally {
      setSavingCreds(false);
    }
  }

  async function submit() {
    setLoading(true);
    setError("");
    setResult(null);
    try {
      const payload =
        editing && username && password ? { username, password, plate } : { plate };
      const res = await run({ data: payload });
      setResult(res);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur inconnue");
    } finally {
      setLoading(false);
      setPassword("");
    }
  }

  const v = result?.vehicle as Record<string, string | undefined> | undefined;
  const rows: [string, string | undefined][] = [
    ["Marque", v?.["marque"]],
    ["Modèle", v?.["modele"]],
    ["Version", v?.["version"]],
    ["VIN", v?.["vin"]],
    ["Code moteur", v?.["codeMoteur"]],
    ["Date MEC", v?.["dateMec"]],
  ];

  return (
    <div className="rounded-xl border-2 border-dashed border-border bg-card px-4 py-4">
      <div className="flex items-center gap-3">
        <Plug className="h-6 w-6 shrink-0 text-brand" />
        <div className="flex-1">
          <div className="text-base font-extrabold uppercase tracking-wide">Connexion IXELLIO</div>
          <div className="text-xs text-muted-foreground">
            {status?.configured
              ? `Identifiants IXELLIO enregistrés (chiffrés)${
                  status.updatedAt ? ` · maj ${new Date(status.updatedAt).toLocaleDateString("fr-FR")}` : ""
                }`
              : "Aucun identifiant enregistré."}
          </div>
        </div>
      </div>

      {editing || !status?.configured ? (
        <div className="mt-3 space-y-3">
          <Field label="Utilisateur IXELLIO" value={username} onChange={setUsername} placeholder="identifiant" />
          <Field label="Mot de passe IXELLIO" value={password} onChange={setPassword} type="password" />
          <div className="flex gap-2">
            <button
              onClick={() => void saveCredentials()}
              disabled={savingCreds || !username || !password}
              className="rounded-lg bg-brand px-3 py-2 text-xs font-extrabold uppercase text-brand-foreground disabled:opacity-60"
            >
              {savingCreds ? "Enregistrement…" : "Enregistrer les identifiants"}
            </button>
            {status?.configured ? (
              <button
                onClick={() => {
                  setEditing(false);
                  setUsername("");
                  setPassword("");
                }}
                className="rounded-lg border-2 border-border px-3 py-2 text-xs font-extrabold uppercase"
              >
                Annuler
              </button>
            ) : null}
          </div>
        </div>
      ) : (
        <button
          onClick={() => setEditing(true)}
          className="mt-3 rounded-lg border-2 border-border px-3 py-2 text-xs font-extrabold uppercase"
        >
          Modifier les identifiants
        </button>
      )}

      <div className="mt-3">
        <Field label="Immatriculation de test" value={plate} onChange={setPlate} placeholder="AA123AA" />
      </div>

      <button
        onClick={() => void submit()}
        disabled={loading || plate.trim().length < 4 || (!status?.configured && (!username || !password))}
        className="mt-3 rounded-lg bg-brand px-3 py-2 text-xs font-extrabold uppercase text-brand-foreground disabled:opacity-60"
      >
        {loading ? "Test en cours…" : "Tester la connexion IXELLIO"}
      </button>

      {error ? (
        <p className="mt-3 rounded-lg bg-red-100 px-3 py-2 text-xs text-red-950">{error}</p>
      ) : null}

      {result ? (
        <div className="mt-3 space-y-2">
          <div className={`rounded-lg px-3 py-2 text-xs font-bold ${OUTCOME_TONE[result.outcome] ?? "bg-secondary"}`}>
            {OUTCOME_LABEL[result.outcome] ?? result.outcome} — {result.message}
          </div>
          <div className="text-[11px] text-muted-foreground">
            Login : HTTP {result.loginStatus ?? "—"}
            {result.loginRedirect ? ` → ${result.loginRedirect}` : ""} · Recherche : HTTP{" "}
            {result.searchStatus ?? "—"}
            {result.searchRedirect ? ` → ${result.searchRedirect}` : ""} · Durée {result.durationMs} ms ·{" "}
            {result.bytes} octets
          </div>
          {result.trace?.length ? (
            <ol className="space-y-1 rounded-lg bg-muted px-3 py-2 font-mono text-[10px] text-muted-foreground">
              {result.trace.map((step, i) => (
                <li key={`${i}-${step}`}>{step}</li>
              ))}
            </ol>
          ) : null}

          {rows.some(([, val]) => val) ? (
            <dl className="grid grid-cols-2 gap-2 rounded-lg bg-muted px-3 py-2 text-xs">
              {rows
                .filter(([, val]) => val)
                .map(([label, val]) => (
                  <div key={label}>
                    <dt className="text-[10px] font-bold uppercase text-muted-foreground">{label}</dt>
                    <dd className="font-semibold">{val}</dd>
                  </div>
                ))}
            </dl>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}



function GlobalSettings() {
  const { isManager } = useAuth();



  if (!isManager) {
    return (
      <AppShell title="Paramétrage global" back={{ to: "/parametrage" }}>
        <p className="rounded-lg bg-amber-100 px-3 py-3 text-sm text-amber-950">Accès réservé aux managers.</p>
      </AppShell>
    );
  }

  return (
    <AppShell title="Paramétrage global" subtitle="Référentiels partagés" back={{ to: "/parametrage" }}>
      <div className="space-y-3 pt-2">
        <Link to="/parametrage/fournisseurs" className="flex items-center gap-4 rounded-xl border-2 border-border bg-card px-4 py-4 active:scale-[0.99]">
          <Truck className="h-6 w-6 shrink-0 text-brand" />
          <div className="flex-1">
            <div className="text-base font-extrabold uppercase tracking-wide">Fournisseurs</div>
            <div className="text-xs text-muted-foreground">Référentiel unique et contacts (magasin PR, retours, commercial…)</div>
          </div>
          <ChevronRight className="h-5 w-5 shrink-0" />
        </Link>
        <Link to="/carrosserie/referentiels" className="flex items-center gap-4 rounded-xl border-2 border-border bg-card px-4 py-4 active:scale-[0.99]">
          <Building2 className="h-6 w-6 shrink-0 text-brand" />
          <div className="flex-1">
            <div className="text-base font-extrabold uppercase tracking-wide">Assurances & experts</div>
            <div className="text-xs text-muted-foreground">Assurances, cabinets, experts et agréments</div>
          </div>
          <ChevronRight className="h-5 w-5 shrink-0" />
        </Link>
        <Link to="/parametrage/tarifs" className="flex items-center gap-4 rounded-xl border-2 border-border bg-card px-4 py-4 active:scale-[0.99]">
          <Euro className="h-6 w-6 shrink-0 text-brand" />
          <div className="flex-1">
            <div className="text-base font-extrabold uppercase tracking-wide">Tarifs atelier</div>
            <div className="text-xs text-muted-foreground">Taux horaires, ingrédients peinture (IGP) et forfaits du garage</div>
          </div>
          <ChevronRight className="h-5 w-5 shrink-0" />
        </Link>
        <Link to="/parametrage/chiffrage" className="flex items-center gap-4 rounded-xl border-2 border-border bg-card px-4 py-4 active:scale-[0.99]">
          <Euro className="h-6 w-6 shrink-0 text-brand" />
          <div className="flex-1">
            <div className="text-base font-extrabold uppercase tracking-wide">Chiffrage & pneumatiques</div>
            <div className="text-xs text-muted-foreground">
              Marge commerciale, forfaits mécaniques, règles peinture et tarifs pneus
            </div>
          </div>
          <ChevronRight className="h-5 w-5 shrink-0" />
        </Link>
        <Link to="/parametrage/messages" className="flex items-center gap-4 rounded-xl border-2 border-border bg-card px-4 py-4 active:scale-[0.99]">
          <MessageSquareText className="h-6 w-6 shrink-0 text-brand" />
          <div className="flex-1">
            <div className="text-base font-extrabold uppercase tracking-wide">Modèles de messages</div>
            <div className="text-xs text-muted-foreground">Textes préremplis des communications expert et client</div>
          </div>
          <ChevronRight className="h-5 w-5 shrink-0" />
        </Link>

        <IxellioSettings />

      </div>
    </AppShell>
  );
}
