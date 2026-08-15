import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";

import { formatPlate } from "@/lib/plate";

type Order = {
  id: string;
  or_number: string | null;
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

export function OrCard({ o }: { o: Order }) {
  const [open, setOpen] = useState(false);
  const v = o.vehicle as { plate?: string; brand?: string; model?: string } | null;
  const c = o.client as { first_name?: string; last_name?: string } | null;
  const hasDetails = Boolean(o.client_remarks || o.requested_work);

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
            <div className="font-bold uppercase text-foreground">OR {o.or_number || "—"}</div>
            <div>{o.or_date ? new Date(o.or_date).toLocaleDateString("fr-FR") : "—"}</div>
          </div>
        </div>
        <div className="mt-1 text-xs text-muted-foreground">
          {[c?.first_name, c?.last_name].filter(Boolean).join(" ") || "Client —"}
        </div>
      </Link>

      {hasDetails ? (
        <>
          <button
            type="button"
            onClick={() => setOpen((v2) => !v2)}
            className="flex w-full items-center justify-between border-t border-border px-4 py-3 text-xs font-bold uppercase tracking-widest text-muted-foreground"
          >
            {open ? "Masquer le détail" : "Voir la demande client"}
            {open ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          </button>
          {open ? (
            <div className="space-y-3 border-t border-border px-4 py-3">
              {o.client_remarks ? (
                <div>
                  <div className="mb-1 text-xs font-bold uppercase tracking-widest text-muted-foreground">
                    Remarques client
                  </div>
                  <Lines text={o.client_remarks} />
                </div>
              ) : null}
              {o.requested_work ? (
                <div>
                  <div className="mb-1 text-xs font-bold uppercase tracking-widest text-muted-foreground">
                    Travaux à prévoir
                  </div>
                  <Lines text={o.requested_work} />
                </div>
              ) : null}
            </div>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
