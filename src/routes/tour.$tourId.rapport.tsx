import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Copy, ExternalLink, Mail, MessageSquareText, Send } from "lucide-react";
import { toast } from "sonner";

import { AppShell } from "@/components/AppShell";
import { formatPlate } from "@/lib/plate";
import { fetchReport } from "@/lib/report";
import { commStatus, COMM_LABELS } from "@/lib/queries";
import { sendTourReport } from "@/lib/report-email.functions";
import { ReportBody, Summary } from "@/components/ReportView";

export const Route = createFileRoute("/tour/$tourId/rapport")({
  head: () => ({
    meta: [
      { title: "Rapport de tour véhicule — DDA Connect" },
      {
        name: "description",
        content: "Rapport atelier complet : contrôles, statuts, mesures, commentaires et photos.",
      },
      { property: "og:title", content: "Rapport de tour véhicule — DDA Connect" },
      { property: "og:description", content: "Rapport atelier complet du tour véhicule." },
    ],
  }),
  component: ReportPage,
});

function ReportPage() {
  const { tourId } = Route.useParams();
  const qc = useQueryClient();
  const [detailed, setDetailed] = useState(true);
  const [sendOpen, setSendOpen] = useState(false);
  const [to, setTo] = useState("");
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);
  const report = useQuery({ queryKey: ["report", tourId], queryFn: () => fetchReport({ id: tourId }) });

  const clientEmail = report.data?.order?.client?.email ?? "";
  useEffect(() => {
    if (clientEmail) setTo((v) => v || clientEmail);
  }, [clientEmail]);

  async function send() {
    if (!/.+@.+\..+/.test(to)) {
      toast.error("Adresse e-mail invalide");
      return;
    }
    setSending(true);
    try {
      const res = await sendTourReport({
        data: {
          inspectionId: tourId,
          to: to.trim(),
          origin: window.location.origin,
          ...(message.trim() ? { message: message.trim() } : {}),
        },
      });
      if (res.ok) {
        toast.success(`Rapport envoyé à ${to.trim()}`);
        setSendOpen(false);
        await qc.invalidateQueries({ queryKey: ["report", tourId] });
        await qc.invalidateQueries({ queryKey: ["recent-tours"] });
      } else {
        toast.error(res.error || "Envoi impossible");
      }
    } catch (e) {
      console.error(e);
      toast.error("Envoi impossible");
    } finally {
      setSending(false);
    }
  }

  if (report.isLoading || !report.data) {
    return (
      <AppShell title="Rapport">
        <p className="text-sm text-muted-foreground">Chargement…</p>
      </AppShell>
    );
  }

  const d = report.data;
  const shareUrl =
    typeof window !== "undefined"
      ? `${window.location.origin}/partage/${d.inspection.share_token}`
      : "";

  return (
    <AppShell
      title="Rapport atelier"
      subtitle={formatPlate(d.vehicle?.plate ?? "")}
      back={d.order ? { to: "/or/$orId", params: { orId: d.order.id } } : { to: "/tour-vehicule" }}
    >
      <div className="space-y-4">
        <Summary d={d} />

        <div className="grid grid-cols-2 gap-2">
          <a
            href={shareUrl}
            target="_blank"
            rel="noreferrer"
            className="flex items-center justify-center gap-2 rounded-lg border-2 border-border bg-card px-3 py-3 text-sm font-bold uppercase"
          >
            <ExternalLink className="h-4 w-4" /> Aperçu client
          </a>
          <button
            onClick={() => {
              void navigator.clipboard.writeText(shareUrl);
              toast.success("Lien copié");
            }}
            className="flex items-center justify-center gap-2 rounded-lg bg-brand px-3 py-3 text-sm font-bold uppercase text-brand-foreground"
          >
            <Copy className="h-4 w-4" /> Copier le lien
          </button>
        </div>

        <div className="card-surface space-y-3 p-4">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-bold uppercase tracking-widest text-muted-foreground">
              Communication client
            </span>
            <span className="text-xs font-bold uppercase">
              {COMM_LABELS[commStatus(d.inspection)]}
            </span>
          </div>
          {d.inspection.last_sent_at ? (
            <p className="text-xs text-muted-foreground">
              Dernier envoi : {new Date(d.inspection.last_sent_at).toLocaleString("fr-FR")}
              {d.inspection.last_sent_to ? ` à ${d.inspection.last_sent_to}` : ""}
            </p>
          ) : null}
          <Link
            to="/tour/$tourId/presentation"
            params={{ tourId }}
            className="flex items-center justify-center gap-2 rounded-lg border-2 border-border bg-card px-3 py-3 text-sm font-bold uppercase"
          >
            <MessageSquareText className="h-4 w-4" /> Préparer la présentation client
          </Link>
          {sendOpen ? (
            <div className="space-y-2">
              <label
                htmlFor="email-to"
                className="block text-xs font-bold uppercase tracking-widest text-muted-foreground"
              >
                E-mail du client
              </label>
              <input
                id="email-to"
                type="email"
                value={to}
                onChange={(e) => setTo(e.target.value)}
                placeholder="client@exemple.fr"
                className="w-full rounded-lg border-2 border-border bg-card px-3 py-3 text-base outline-none focus:border-brand"
              />
              <label
                htmlFor="email-msg"
                className="block text-xs font-bold uppercase tracking-widest text-muted-foreground"
              >
                Message d'accompagnement (facultatif)
              </label>
              <textarea
                id="email-msg"
                rows={3}
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                placeholder="Bonjour, voici le compte rendu du contrôle de votre véhicule."
                className="w-full rounded-lg border-2 border-border bg-card px-3 py-2 text-sm outline-none focus:border-brand"
              />
              <div className="flex gap-2">
                <button
                  onClick={() => setSendOpen(false)}
                  className="flex-1 rounded-lg border-2 border-border bg-card px-3 py-3 text-sm font-bold uppercase"
                >
                  Annuler
                </button>
                <button
                  onClick={() => void send()}
                  disabled={sending}
                  className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-brand px-3 py-3 text-sm font-bold uppercase text-brand-foreground disabled:opacity-60"
                >
                  <Send className="h-4 w-4" /> {sending ? "Envoi…" : "Envoyer"}
                </button>
              </div>
            </div>
          ) : (
            <button
              onClick={() => setSendOpen(true)}
              className="flex w-full items-center justify-center gap-2 rounded-lg bg-brand px-3 py-3 text-sm font-bold uppercase text-brand-foreground"
            >
              <Mail className="h-4 w-4" /> Envoyer le rapport au client
            </button>
          )}
        </div>

        <div className="flex gap-2">
          <button
            onClick={() => setDetailed(false)}
            className={`flex-1 rounded-lg border-2 px-3 py-2 text-sm font-bold uppercase ${!detailed ? "border-brand bg-brand/20" : "border-border bg-card"}`}
          >
            Synthèse
          </button>
          <button
            onClick={() => setDetailed(true)}
            className={`flex-1 rounded-lg border-2 px-3 py-2 text-sm font-bold uppercase ${detailed ? "border-brand bg-brand/20" : "border-border bg-card"}`}
          >
            Détail
          </button>
        </div>

        <ReportBody d={d} detailed={detailed} clientView={false} />
      </div>
    </AppShell>
  );
}

