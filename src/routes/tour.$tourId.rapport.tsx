import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Archive, ArchiveRestore, Copy, ExternalLink, FileDown, Mail, MessageSquareText, Pencil, Send, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { AppShell } from "@/components/AppShell";
import { formatPlate } from "@/lib/plate";
import { fetchReport } from "@/lib/report";
import { commStatus, COMM_LABELS } from "@/lib/queries";
import { sendTourReport } from "@/lib/report-email.functions";
import { notifyTourFrontOffice } from "@/lib/tour-notify.functions";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { archiveTour, deleteTour, unarchiveTour } from "@/lib/tour-admin";
import { ReportBody, Summary } from "@/components/ReportView";
import { TourQuoteSection } from "@/components/TourQuoteSection";

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
  const { user, displayName, isManager } = useAuth();
  const navigate = Route.useNavigate();
  const [detailed, setDetailed] = useState(true);
  const [sendOpen, setSendOpen] = useState(false);

  const [sendToClient, setSendToClient] = useState(false);
  const [clientTo, setClientTo] = useState("");
  const [clientMessage, setClientMessage] = useState("");

  const [sendToMe, setSendToMe] = useState(false);
  const [meTo, setMeTo] = useState("");
  const [meMessage, setMeMessage] = useState("");

  const [sending, setSending] = useState(false);
  const report = useQuery({ queryKey: ["report", tourId], queryFn: () => fetchReport({ id: tourId }) });

  const clientEmail = report.data?.order?.client?.email ?? "";
  useEffect(() => {
    if (clientEmail) {
      setClientTo((v) => v || clientEmail);
      setSendToClient((v) => v || true);
    }
  }, [clientEmail]);
  useEffect(() => {
    if (user?.email) setMeTo((v) => v || (user.email as string));
  }, [user]);

  async function send() {
    if (!sendToClient && !sendToMe) {
      toast.error("Sélectionnez au moins un destinataire");
      return;
    }
    if (sendToClient && !/.+@.+\..+/.test(clientTo)) {
      toast.error("Adresse e-mail du client invalide");
      return;
    }
    if (sendToMe && !/.+@.+\..+/.test(meTo)) {
      toast.error("Votre adresse e-mail est invalide");
      return;
    }
    setSending(true);
    try {
      const jobs: Promise<{ ok: boolean; error: string; to: string }>[] = [];
      if (sendToClient) {
        jobs.push(
          sendTourReport({
            data: {
              inspectionId: tourId,
              to: clientTo.trim(),
              origin: window.location.origin,
              ...(clientMessage.trim() ? { message: clientMessage.trim() } : {}),
            },
          }).then((res) => ({ ok: res.ok, error: res.error ?? "", to: clientTo.trim() })),
        );
      }
      if (sendToMe) {
        jobs.push(
          sendTourReport({
            data: {
              inspectionId: tourId,
              to: meTo.trim(),
              origin: window.location.origin,
              ...(meMessage.trim() ? { message: meMessage.trim() } : {}),
            },
          }).then((res) => ({ ok: res.ok, error: res.error ?? "", to: meTo.trim() })),
        );
      }
      const results = await Promise.all(jobs);
      const okList = results.filter((r) => r.ok);
      const failList = results.filter((r) => !r.ok);
      if (okList.length) {
        toast.success(`Rapport envoyé à ${okList.map((r) => r.to).join(" et ")}`);
      }
      for (const f of failList) {
        toast.error(f.error || `Envoi impossible à ${f.to}`);
      }
      if (!failList.length) {
        setSendOpen(false);
      }
      await qc.invalidateQueries({ queryKey: ["report", tourId] });
      await qc.invalidateQueries({ queryKey: ["recent-tours"] });
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
      back={{ to: "/tours" }}
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
          <a
            href={`/tour/${tourId}/pdf`}
            target="_blank"
            rel="noreferrer"
            className="col-span-2 flex items-center justify-center gap-2 rounded-lg border-2 border-border bg-card px-3 py-3 text-sm font-bold uppercase"
          >
            <FileDown className="h-4 w-4" /> Exporter PDF
          </a>
        </div>

        <TourManagement
          tourId={tourId}
          archivedAt={(d.inspection as { archived_at?: string | null }).archived_at ?? null}
          lastModifiedAt={(d.inspection as { last_modified_at?: string | null }).last_modified_at ?? null}
          lastModifiedBy={(d.inspection as { last_modified_by_name?: string | null }).last_modified_by_name ?? null}
          isManager={isManager}
          onChanged={async () => {
            await qc.invalidateQueries({ queryKey: ["report", tourId] });
            await qc.invalidateQueries({ queryKey: ["all-tours"] });
            await qc.invalidateQueries({ queryKey: ["recent-tours"] });
          }}
          onDeleted={() => navigate({ to: "/tours" })}
          actor={{ userId: user?.id ?? null, userName: displayName || null }}
        />

        <TourQuoteSection
          inspectionId={d.inspection.id}
          plate={d.vehicle?.plate ?? null}
          brand={d.vehicle?.brand ?? null}
          model={d.vehicle?.model ?? null}
          repairOrderId={d.order?.id ?? null}
        />

        <FrontOfficeBlock tourId={tourId} isManager={isManager} />

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
            <div className="space-y-4">
              <div className="space-y-2 rounded-lg border-2 border-border p-3">
                <label className="flex items-center gap-2 text-sm font-bold">
                  <input
                    type="checkbox"
                    checked={sendToClient}
                    onChange={(e) => setSendToClient(e.target.checked)}
                    className="h-5 w-5"
                  />
                  Envoyer au client
                </label>
                {sendToClient ? (
                  <>
                    <input
                      type="email"
                      value={clientTo}
                      onChange={(e) => setClientTo(e.target.value)}
                      placeholder="client@exemple.fr"
                      aria-label="E-mail du client"
                      className="w-full rounded-lg border-2 border-border bg-card px-3 py-3 text-base outline-none focus:border-brand"
                    />
                    <textarea
                      rows={3}
                      value={clientMessage}
                      onChange={(e) => setClientMessage(e.target.value)}
                      placeholder="Bonjour, voici le compte rendu du contrôle de votre véhicule."
                      aria-label="Message d'accompagnement au client"
                      className="w-full rounded-lg border-2 border-border bg-card px-3 py-2 text-sm outline-none focus:border-brand"
                    />
                    {!clientEmail ? (
                      <p className="text-xs text-muted-foreground">
                        Aucun e-mail client connu — saisissez-en un pour envoyer.
                      </p>
                    ) : null}
                  </>
                ) : null}
              </div>

              <div className="space-y-2 rounded-lg border-2 border-border p-3">
                <label className="flex items-center gap-2 text-sm font-bold">
                  <input
                    type="checkbox"
                    checked={sendToMe}
                    onChange={(e) => setSendToMe(e.target.checked)}
                    className="h-5 w-5"
                  />
                  M'envoyer le compte rendu
                </label>
                {sendToMe ? (
                  <>
                    <input
                      type="email"
                      value={meTo}
                      onChange={(e) => setMeTo(e.target.value)}
                      placeholder="moi@exemple.fr"
                      aria-label="Mon e-mail"
                      className="w-full rounded-lg border-2 border-border bg-card px-3 py-3 text-base outline-none focus:border-brand"
                    />
                    <textarea
                      rows={2}
                      value={meMessage}
                      onChange={(e) => setMeMessage(e.target.value)}
                      placeholder="Note personnelle (facultatif)"
                      aria-label="Message d'accompagnement personnel"
                      className="w-full rounded-lg border-2 border-border bg-card px-3 py-2 text-sm outline-none focus:border-brand"
                    />
                  </>
                ) : null}
              </div>

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
              <Mail className="h-4 w-4" /> Envoyer le compte rendu
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

        <ReportBody
          d={d}
          detailed={detailed}
          clientView={false}
          editable
          onSaved={() => void qc.invalidateQueries({ queryKey: ["report", tourId] })}
        />
      </div>
    </AppShell>
  );
}

type NotifRow = {
  id: string;
  recipients: string[];
  status: string;
  error_message: string | null;
  sent_at: string | null;
  photo_count: number;
  created_at: string;
};

const NOTIF_LABEL: Record<string, string> = {
  sent: "Envoyée",
  partial: "Partiellement envoyée",
  failed: "En erreur",
  no_recipients: "Aucun destinataire actif",
  pending: "En cours",
};

/** Traçabilité de la notification Front Office + renvoi manuel (manager). */
function FrontOfficeBlock({ tourId, isManager }: { tourId: string; isManager: boolean }) {
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [lastError, setLastError] = useState("");
  const notifs = useQuery({
    queryKey: ["tour-notifications", tourId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("tour_notifications")
        .select("id, recipients, status, error_message, sent_at, photo_count, created_at")
        .eq("inspection_id", tourId)
        .order("created_at", { ascending: false })
        .limit(5);
      if (error) throw error;
      return (data ?? []) as NotifRow[];
    },
  });

  const resend = async () => {
    setBusy(true);
    setLastError("");
    try {
      const res = await notifyTourFrontOffice({
        data: { inspectionId: tourId, origin: window.location.origin },
      });
      if (res.ok) {
        toast.success(`Notification renvoyée (${res.recipients.length} destinataire(s))`);
      } else {
        const msg = res.error || "Envoi impossible (raison inconnue)";
        setLastError(msg);
        toast.error(msg);
      }
      await qc.invalidateQueries({ queryKey: ["tour-notifications", tourId] });
    } catch (e) {
      console.error(e);
      const msg = `Envoi impossible : ${e instanceof Error ? e.message : String(e)}`;
      setLastError(msg);
      toast.error(msg);
    } finally {
      setBusy(false);
    }
  };

  const last = notifs.data?.[0];
  const noRecipient = /destinataire front office configur/i.test(lastError);

  return (
    <div className="card-surface space-y-2 p-4">
      <span className="text-xs font-bold uppercase tracking-widest text-muted-foreground">
        Notification Front Office
      </span>
      {last ? (
        <p className="text-xs text-muted-foreground">
          {NOTIF_LABEL[last.status] ?? last.status} ·{" "}
          {new Date(last.sent_at ?? last.created_at).toLocaleString("fr-FR")} ·{" "}
          {last.recipients.join(", ") || "aucun destinataire"} · {last.photo_count} photo(s)
          {last.error_message ? ` · ${last.error_message}` : ""}
        </p>
      ) : (
        <p className="text-xs text-muted-foreground">Aucune notification enregistrée pour ce tour.</p>
      )}
      {isManager ? (
        <>
        {lastError ? (
          <p className="text-xs font-bold text-destructive">{lastError}</p>
        ) : null}
        {noRecipient ? (
          <Link
            to="/parametrage/notifications"
            className="block text-xs font-bold uppercase underline"
          >
            Configurer les destinataires Front Office
          </Link>
        ) : null}
        <button
          onClick={() => void resend()}
          disabled={busy}
          className="flex w-full items-center justify-center gap-2 rounded-lg border-2 border-border bg-card px-3 py-3 text-sm font-bold uppercase disabled:opacity-50"
        >
          <Send className="h-4 w-4" /> {busy ? "Envoi en cours…" : "Renvoyer au Front Office"}
        </button>
        </>
      ) : null}
    </div>
  );
}

/** §3 — modification, archivage et suppression d'un tour terminé. */
function TourManagement({
  tourId,
  archivedAt,
  lastModifiedAt,
  lastModifiedBy,
  isManager,
  onChanged,
  onDeleted,
  actor,
}: {
  tourId: string;
  archivedAt: string | null;
  lastModifiedAt: string | null;
  lastModifiedBy: string | null;
  isManager: boolean;
  onChanged: () => Promise<void> | void;
  onDeleted: () => void;
  actor: { userId: string | null; userName: string | null };
}) {
  const [busy, setBusy] = useState(false);

  const run = async (fn: () => Promise<void>, ok: string) => {
    setBusy(true);
    try {
      await fn();
      toast.success(ok);
      await onChanged();
    } catch (e) {
      console.error(e);
      toast.error(e instanceof Error ? e.message : "Action impossible");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="card-surface space-y-2 p-4">
      <span className="text-xs font-bold uppercase tracking-widest text-muted-foreground">
        Gestion du tour
      </span>
      {archivedAt ? (
        <p className="rounded-lg bg-secondary px-3 py-2 text-xs font-bold uppercase">
          Tour archivé le {new Date(archivedAt).toLocaleString("fr-FR")}
        </p>
      ) : null}
      {lastModifiedAt ? (
        <p className="text-xs text-muted-foreground">
          Dernière modification : {new Date(lastModifiedAt).toLocaleString("fr-FR")}
          {lastModifiedBy ? ` par ${lastModifiedBy}` : ""}
        </p>
      ) : null}
      <div className="grid grid-cols-2 gap-2">
        <Link
          to="/tour/$tourId"
          params={{ tourId }}
          search={{ edit: true }}
          className="flex items-center justify-center gap-2 rounded-lg border-2 border-border bg-card px-3 py-3 text-sm font-bold uppercase"
        >
          <Pencil className="h-4 w-4" /> Modifier le tour
        </Link>
        {archivedAt ? (
          <button
            disabled={busy}
            onClick={() => void run(() => unarchiveTour(tourId), "Tour désarchivé")}
            className="flex items-center justify-center gap-2 rounded-lg border-2 border-border bg-card px-3 py-3 text-sm font-bold uppercase disabled:opacity-60"
          >
            <ArchiveRestore className="h-4 w-4" /> Désarchiver
          </button>
        ) : (
          <button
            disabled={busy}
            onClick={() => {
              if (!window.confirm("Archiver ce tour ? Il restera consultable via le filtre Archivés.")) return;
              void run(() => archiveTour(tourId, actor), "Tour archivé");
            }}
            className="flex items-center justify-center gap-2 rounded-lg border-2 border-border bg-card px-3 py-3 text-sm font-bold uppercase disabled:opacity-60"
          >
            <Archive className="h-4 w-4" /> Archiver
          </button>
        )}
      </div>
      {isManager ? (
        <button
          disabled={busy}
          onClick={() => {
            if (!window.confirm("Supprimer définitivement ce tour ? Cette action est irréversible.")) return;
            if (!window.confirm("Confirmer une seconde fois la suppression définitive.")) return;
            void run(async () => {
              await deleteTour(tourId);
              onDeleted();
            }, "Tour supprimé définitivement");
          }}
          className="flex w-full items-center justify-center gap-2 rounded-lg border-2 border-destructive px-3 py-3 text-sm font-bold uppercase text-destructive disabled:opacity-60"
        >
          <Trash2 className="h-4 w-4" /> Supprimer définitivement (manager)
        </button>
      ) : null}
    </div>
  );
}
