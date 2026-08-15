import { Link } from "@tanstack/react-router";
import { AlertTriangle, Eye, Mail, MailCheck, MailWarning } from "lucide-react";

import { formatPlate } from "@/lib/plate";
import { COMM_LABELS, type RecentTour } from "@/lib/queries";

const COMM_STYLE: Record<string, string> = {
  not_sent: "bg-muted text-muted-foreground",
  sent: "bg-status-ok-soft text-status-ok",
  modified: "bg-status-watch-soft text-status-watch",
};

export function TourRow({ t }: { t: RecentTour }) {
  const Icon = t.comm === "sent" ? MailCheck : t.comm === "modified" ? MailWarning : Mail;
  const date = new Date(t.completed_at ?? t.started_at);
  return (
    <Link
      to="/tour/$tourId/rapport"
      params={{ tourId: t.id }}
      className="card-surface block p-4 active:scale-[0.995]"
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="plate-badge text-xl">{formatPlate(t.plate)}</div>
          <div className="text-sm font-medium">
            {[t.brand, t.model].filter(Boolean).join(" ") || "Véhicule"}
          </div>
        </div>
        <div className="text-right text-xs text-muted-foreground">
          <div>{date.toLocaleDateString("fr-FR")}</div>
          <div>{t.inspection_type === "guide" ? "Tour guidé" : "Tour libre"}</div>
          {t.status !== "completed" ? (
            <div className="font-bold uppercase text-status-watch">En cours</div>
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
