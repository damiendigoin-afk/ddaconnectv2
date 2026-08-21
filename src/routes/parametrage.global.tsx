import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { Building2, ChevronRight, MessageSquareText, Plug, Truck } from "lucide-react";
import { useState } from "react";

import { AppShell } from "@/components/AppShell";
import { Field } from "@/components/bits";
import { testIxellioAuth } from "@/lib/ixellio.functions";

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
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [plate, setPlate] = useState("AA123AA");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<TestResult | null>(null);
  const [error, setError] = useState("");

  async function submit() {
    setLoading(true);
    setError("");
    setResult(null);
    try {
      const res = await run({ data: { username, password, plate } });
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
            Test temporaire — identifiants non enregistrés, utilisés uniquement le temps de la requête serveur.
          </div>
        </div>
      </div>

      <div className="mt-3 space-y-3">
        <Field label="Utilisateur IXELLIO" value={username} onChange={setUsername} placeholder="identifiant" />
        <Field label="Mot de passe IXELLIO" value={password} onChange={setPassword} type="password" />
        <Field label="Immatriculation de test" value={plate} onChange={setPlate} placeholder="AA123AA" />
      </div>

      <button
        onClick={() => void submit()}
        disabled={loading || !username || !password || plate.trim().length < 4}
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
            Login : HTTP {result.loginStatus ?? "—"} · Recherche : HTTP {result.searchStatus ?? "—"} · Durée{" "}
            {result.durationMs} ms · {result.bytes} octets
          </div>
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
