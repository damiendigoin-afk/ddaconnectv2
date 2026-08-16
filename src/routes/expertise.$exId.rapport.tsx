import { useEffect, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Link2, Loader2, Mail, Pencil, Printer } from "lucide-react";
import { toast } from "sonner";

import { AppShell } from "@/components/AppShell";
import { ExpertiseReport } from "@/components/ExpertiseReportView";
import { useAuth } from "@/lib/auth";
import { fetchExpertise } from "@/lib/expertise";
import { sendExpertiseReport } from "@/lib/expertise-email.functions";
import { isValidEmail } from "@/lib/validation";

export const Route = createFileRoute("/expertise/$exId/rapport")({
  head: () => ({
    meta: [
      { title: "Rapport d'expertise — DDA Connect" },
      {
        name: "description",
        content:
          "Rapport d'expertise véhicule : photos, dommages chiffrés, estimation totale et envoi au client.",
      },
      { property: "og:title", content: "Rapport d'expertise — DDA Connect" },
      {
        property: "og:description",
        content: "Photos, dommages chiffrés et estimation totale des remises en état.",
      },
      { property: "og:type", content: "article" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: ExpertiseReportPage,
});

function ExpertiseReportPage() {
  const { exId } = Route.useParams();
  const { user } = useAuth();
  const q = useQuery({ queryKey: ["expertise", exId], queryFn: () => fetchExpertise({ id: exId }) });
  const [sendToClient, setSendToClient] = useState(true);
  const [clientEmail, setClientEmail] = useState("");
  const [sendToMe, setSendToMe] = useState(false);
  const [myEmail, setMyEmail] = useState("");
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);
  useEffect(() => {
    if (user?.email) setMyEmail((v: string) => v || (user.email as string));
  }, [user?.email]);

  const e = q.data?.expertise;

  async function sendOne(to: string, withMessage: boolean) {
    const res = await sendExpertiseReport({
      data: {
        expertiseId: exId,
        to,
        origin: window.location.origin,
        ...(withMessage && message ? { message } : {}),
      },
    });
    return res;
  }

  async function sendAll() {
    const targets: { to: string; withMessage: boolean }[] = [];
    if (sendToClient) {
      if (!isValidEmail(clientEmail)) {
        toast.error("Adresse e-mail client invalide.");
        return;
      }
      targets.push({ to: clientEmail, withMessage: true });
    }
    if (sendToMe) {
      if (!isValidEmail(myEmail)) {
        toast.error("Votre adresse e-mail est invalide.");
        return;
      }
      targets.push({ to: myEmail, withMessage: false });
    }
    if (!targets.length) {
      toast.error("Choisissez au moins un destinataire.");
      return;
    }
    setSending(true);
    try {
      const results = await Promise.all(targets.map((t) => sendOne(t.to, t.withMessage)));
      const failed = results.filter((r) => !r.ok);
      if (failed.length) toast.error(failed[0]?.error || "Échec de l'envoi.");
      else toast.success(targets.length > 1 ? "Rapport envoyé." : `Rapport envoyé à ${targets[0]!.to}.`);
      await q.refetch();
    } finally {
      setSending(false);
    }
  }

  return (
    <AppShell
      title="Rapport d'expertise"
      subtitle={e?.plate ?? ""}
      back={{ to: "/expertises" }}
      right={
        <button
          onClick={() => window.print()}
          aria-label="Imprimer ou enregistrer en PDF"
          className="rounded-lg border border-border p-2 text-muted-foreground print:hidden"
        >
          <Printer className="h-4 w-4" />
        </button>
      }
    >
      {q.isLoading || !q.data ? (
        <p className="text-sm text-muted-foreground">Chargement…</p>
      ) : (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-2 print:hidden">
            <Link
              to="/expertise/$exId"
              params={{ exId }}
              className="flex items-center justify-center gap-2 rounded-lg border-2 border-border bg-card px-3 py-3 text-sm font-bold uppercase"
            >
              <Pencil className="h-4 w-4" /> Modifier
            </Link>
            <button
              onClick={() => {
                const url = `${window.location.origin}/expertise-partage/${q.data.expertise.share_token}`;
                void navigator.clipboard.writeText(url);
                toast.success("Lien du rapport copié");
              }}
              className="flex items-center justify-center gap-2 rounded-lg border-2 border-border bg-card px-3 py-3 text-sm font-bold uppercase"
            >
              <Link2 className="h-4 w-4" /> Copier le lien
            </button>
          </div>

          <ExpertiseReport d={q.data} />

          <section className="card-surface space-y-3 p-4 print:hidden">
            <h2 className="text-sm font-extrabold uppercase tracking-wide">Envoi du rapport</h2>
            {e?.last_sent_at ? (
              <p className="text-xs text-muted-foreground">
                Dernier envoi le {new Date(e.last_sent_at).toLocaleString("fr-FR")} à{" "}
                {e.last_sent_to}
              </p>
            ) : null}

            <label className="flex items-center gap-2 text-sm font-bold uppercase">
              <input
                type="checkbox"
                checked={sendToClient}
                onChange={(ev) => setSendToClient(ev.target.checked)}
                className="h-5 w-5"
              />
              Envoyer au client
            </label>
            {sendToClient ? (
              <div className="space-y-2 pl-1">
                <input
                  type="email"
                  value={clientEmail}
                  onChange={(ev) => setClientEmail(ev.target.value)}
                  placeholder="client@email.fr"
                  className="w-full rounded-lg border-2 border-border bg-background px-3 py-3 text-base font-semibold"
                />
                <textarea
                  value={message}
                  onChange={(ev) => setMessage(ev.target.value)}
                  rows={3}
                  placeholder="Message d'accompagnement (facultatif)"
                  className="w-full rounded-lg border-2 border-border bg-background px-3 py-3 text-base"
                />
              </div>
            ) : null}

            <label className="flex items-center gap-2 text-sm font-bold uppercase">
              <input
                type="checkbox"
                checked={sendToMe}
                onChange={(ev) => setSendToMe(ev.target.checked)}
                className="h-5 w-5"
              />
              M'envoyer le rapport
            </label>
            {sendToMe ? (
              <input
                type="email"
                value={myEmail}
                onChange={(ev) => setMyEmail(ev.target.value)}
                placeholder="moi@email.fr"
                className="w-full rounded-lg border-2 border-border bg-background px-3 py-3 text-base font-semibold"
              />
            ) : null}

            <button
              onClick={() => void sendAll()}
              disabled={sending}
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-brand px-4 py-4 text-sm font-extrabold uppercase text-brand-foreground disabled:opacity-60"
            >
              {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Mail className="h-4 w-4" />}
              Envoyer
            </button>
          </section>
        </div>
      )}
    </AppShell>
  );
}