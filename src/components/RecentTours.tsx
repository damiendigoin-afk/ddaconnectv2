import { Link } from "@tanstack/react-router";
import { AlertTriangle, Clock, Eye, Mail, MailCheck, MailWarning, User } from "lucide-react";
import { useEffect, useState } from "react";

import { formatPlate } from "@/lib/plate";
import { COMM_LABELS, type RecentTour } from "@/lib/queries";
import { OR_PENDING_LABEL, isOrPending, orLabel } from "@/lib/or-ref";

const COMM_STYLE: Record<string, string> = {
  not_sent: "bg-muted text-muted-foreground",
  sent: "bg-status-ok-soft text-status-ok",
  modified: "bg-status-watch-soft text-status-watch",
};

function formatDuration(s: number) {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h} h ${String(m).padStart(2, "0")} min`;
  if (m > 0) return `${m} min ${String(sec).padStart(2, "0")} s`;
  return `${sec} s`;
}

export function TourRow({ t, resume }: { t: RecentTour; resume?: boolean }) {
  const Icon = t.comm === "sent" ? MailCheck : t.comm === "modified" ? MailWarning : Mail;
  const date = new Date(t.completed_at ?? t.started_at ?? Date.now());
  const open = resume ?? t.status !== "completed";
  const ongoing = t.status !== "completed";
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!ongoing || !t.started_at) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [ongoing, t.started_at]);

  const startedAt = t.started_at ? new Date(t.started_at) : null;
  const finishedAt = t.finished_at
    ? new Date(t.finished_at)
    : t.completed_at
      ? new Date(t.completed_at)
      : null;
  const duration = ongoing
    ? startedAt
      ? Math.max(0, Math.round((now - startedAt.getTime()) / 1000))
      : null
    : (t.duration_seconds ??
      (startedAt && finishedAt
        ? Math.max(0, Math.round((finishedAt.getTime() - startedAt.getTime()) / 1000))
        : null));
  return (
    <Link
      to={open ? "/tour/$tourId" : "/tour/$tourId/rapport"}
      params={{ tourId: t.id }}
      className="card-surface block p-4 active:scale-[0.995]"
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="plate-badge text-xl">{formatPlate(t.plate)}</div>
          <div className="text-sm font-medium">
            {[t.brand, t.model].filter(Boolean).join(" ") || "Véhicule"}
          </div>
          <div className="text-xs text-muted-foreground">{t.client_name || "Client —"}</div>
        </div>
        <div className="text-right text-xs text-muted-foreground">
          <div className="font-bold uppercase text-foreground">{orLabel(t)}</div>
          {isOrPending(t) ? (
            <div className="text-[10px] font-bold uppercase text-status-watch">{OR_PENDING_LABEL}</div>
          ) : null}
          <div>
            {date.toLocaleDateString("fr-FR")} à{" "}
            {date.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}
          </div>
          <div className="flex flex-wrap items-center justify-end gap-x-2 gap-y-0.5">
            {t.operator_name ? (
              <span className="inline-flex items-center gap-1">
                <User className="h-3 w-3" /> {t.operator_name}
              </span>
            ) : null}
            {duration != null ? (
              <span className="inline-flex items-center gap-1">
                <Clock className="h-3 w-3" />
                {ongoing ? "En cours · " : ""}
                {formatDuration(duration)}
              </span>
            ) : null}
          </div>
          <div>{t.inspection_type === "guide" ? "Tour guidé" : "Tour libre"}</div>
          {t.status !== "completed" ? (
            <div className="font-bold uppercase text-status-watch">
              {open ? "Reprendre le tour" : "En cours"}
            </div>
          ) : null}
        </div>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
        <span
          className={`inline-flex items-center gap-1 rounded-full px-2 py-1 font-bold uppercase ${COMM_STYLE[t.comm]}`}
        >
          <Icon className="h-3.5 w-3.5" /> {COMM_LABELS[t.comm]}
        </span>
        {t.defects > 0 ? (
          <span className="inline-flex items-center gap-1 rounded-full bg-status-defect-soft px-2 py-1 font-bold text-status-defect">
            <AlertTriangle className="h-3.5 w-3.5" /> {t.defects} défaut(s)
          </span>
        ) : null}
        {t.watches > 0 ? (
          <span className="inline-flex items-center gap-1 rounded-full bg-status-watch-soft px-2 py-1 font-bold text-status-watch">
            <Eye className="h-3.5 w-3.5" /> {t.watches} à surveiller
          </span>
        ) : null}
      </div>
    </Link>
  );
}
