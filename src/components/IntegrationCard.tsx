/** Carte générique d'une connexion externe (clé serveur ou compte à connecter). */
import type { ReactNode } from "react";

import { STATUS_TONE, computeStatus, fmtCheck, statusText, type StatusInput } from "@/lib/integration-status";

export function IntegrationCard({
  title,
  description,
  status,
  account,
  scope,
  children,
  actions,
}: {
  title: string;
  description: string;
  status: StatusInput;
  /** Compte / page relié, jamais un secret. */
  account?: string | null;
  /** Site ou groupe concerné. */
  scope?: string | null;
  children?: ReactNode;
  actions?: ReactNode;
}) {
  const tone = STATUS_TONE[computeStatus(status)];
  return (
    <div className="rounded-xl border-2 border-border p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="text-xs font-bold uppercase tracking-widest">{title}</h3>
          <p className="mt-1 text-xs text-muted-foreground">{description}</p>
        </div>
        <span className={`rounded-lg border-2 px-2 py-1 text-[10px] font-bold uppercase ${tone}`}>
          {statusText(status)}
        </span>
      </div>

      <dl className="mt-2 space-y-0.5 text-[11px] text-muted-foreground">
        {account ? (
          <div>
            <span className="font-bold">Compte relié :</span> {account}
          </div>
        ) : null}
        {scope ? (
          <div>
            <span className="font-bold">Périmètre :</span> {scope}
          </div>
        ) : null}
        <div>
          <span className="font-bold">Dernière vérification :</span> {fmtCheck(status.lastCheckAt)}
          {status.lastCheckMessage ? ` — ${status.lastCheckMessage}` : ""}
        </div>
      </dl>

      {children ? <div className="mt-2 space-y-2">{children}</div> : null}
      {actions ? <div className="mt-2 flex flex-wrap gap-2">{actions}</div> : null}
    </div>
  );
}
