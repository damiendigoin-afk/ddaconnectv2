import { Link } from "@tanstack/react-router";
import { useState } from "react";

import { formatPlate } from "@/lib/plate";
import { OR_PENDING_LABEL, isOrPending, orLabel } from "@/lib/or-ref";

type Order = {
  id: string;
  or_number: string | null;
  internal_ref?: string | null;
  or_status?: string | null;
  or_date: string | null;
  client_remarks: string | null;
  requested_work: string | null;
  vehicle: unknown;
  client: unknown;
};

function Lines({ text }: { text: string }) {
  const lines = text
    .split(/\r?\n|(?:^|\s)[-•]\s+/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (lines.length <= 1) return <p className="text-sm text-foreground">{text}</p>;
  return (
    <ul className="list-disc space-y-1 pl-4 text-sm text-foreground">
      {lines.map((l, i) => (
        <li key={i}>{l}</li>
      ))}
    </ul>
  );
}

/** Bloc texte toujours visible, tronqué au-delà de 4 lignes avec « Voir plus ». */
function Block({ title, text }: { title: string; text: string }) {
  const [open, setOpen] = useState(false);
  const long = text.length > 180 || text.split(/\r?\n/).length > 4;
  return (
    <div>
      <div className="mb-1 text-xs font-bold uppercase tracking-widest text-muted-foreground">
        {title}
      </div>
      <div className={!open && long ? "line-clamp-4 overflow-hidden" : ""}>
        <Lines text={text} />
      </div>
      {long ? (
        <button
          type="button"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            setOpen((v) => !v);
          }}
          className="mt-1 text-xs font-bold uppercase tracking-widest text-brand"
        >
          {open ? "Voir moins" : "Voir plus"}
        </button>
      ) : null}
    </div>
  );
}

export function OrCard({ o }: { o: Order }) {
  const v = o.vehicle as { plate?: string; brand?: string; model?: string } | null;
  const c = o.client as { first_name?: string; last_name?: string } | null;

  return (
    <div className="card-surface overflow-hidden">
      <Link to="/or/$orId" params={{ orId: o.id }} className="block p-4 active:scale-[0.995]">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="plate-badge text-xl">{formatPlate(v?.plate ?? "")}</div>
            <div className="text-sm font-medium text-foreground">
              {[v?.brand, v?.model].filter(Boolean).join(" ") || "Véhicule"}
            </div>
          </div>
          <div className="text-right text-xs text-muted-foreground">
            <div className="font-bold uppercase text-foreground">{orLabel(o)}</div>
            {isOrPending(o) ? (
              <div className="text-[10px] font-bold uppercase text-status-watch">{OR_PENDING_LABEL}</div>
            ) : null}
            <div>{o.or_date ? new Date(o.or_date).toLocaleDateString("fr-FR") : "—"}</div>
          </div>
        </div>
        <div className="mt-1 text-sm font-semibold text-foreground">
          {[c?.first_name, c?.last_name].filter(Boolean).join(" ") || "Client —"}
        </div>

        {o.client_remarks || o.requested_work ? (
          <div className="mt-3 space-y-3 border-t border-border pt-3">
            {o.client_remarks ? <Block title="Demande client" text={o.client_remarks} /> : null}
            {o.requested_work ? <Block title="Travaux prévus" text={o.requested_work} /> : null}
          </div>
        ) : null}
      </Link>
    </div>
  );
}
