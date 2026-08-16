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
  useEffect(() => {
    if (user?.email) setMyEmail((v) => v || (user.email as string));
  }, [user?.email]); // eslint-disable-line react-hooks/exhaustive-deps
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);

  const e = q.data?.expertise;

  async function send(to = email, silent = false) {
    if (!isValidEmail(to)) {
      toast.error("Adresse e-mail invalide.");
      return;
    }
    setSending(true);
    try {
      const res = await sendExpertiseReport({
        data: {
          expertiseId: exId,
          to,
          origin: window.location.origin,
          ...(message && !silent ? { message } : {}),
        },
      });
      if (res.ok) {
        toast.success(silent ? "Rapport envoyé sur votre e-mail." : "Rapport envoyé au client.");
        await q.refetch();
      } else {
        toast.error(res.error || "Échec de l'envoi.");
      }
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