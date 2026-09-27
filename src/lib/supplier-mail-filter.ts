/** Pièces & achats — filtre pur de la file « Reçus par e-mail » (documents opérationnels uniquement). */

export type MailLite = {
  sent_at: string;
  from_address: string | null;
  to_addresses?: string[] | null;
  cc_addresses?: string[] | null;
  subject: string | null;
  triage_status: string | null;
  site_id: string | null;
  files: string[];
};

const norm = (s: string | null | undefined) =>
  (s ?? "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");

const STRONG_SUBJECT = /(facture|bon de livraison|\bbl\b|\bavoir\b|bon de retour|livraison)/;
const EXCLUDE_SUBJECT = /(newsletter|offre|promo|tarif|contrat|obligation|reglementaire|information|webinar|invitation|salon)/;
const DEDICATED_BL = ["bl@garagecastillon.fr"];
const DOC_SENDERS = ["vos.documents@groupecazes.fr"];

/** Vraies pièces jointes documentaires (exclut image001.png, logos, signatures). */
export function documentAttachments(files: string[]): string[] {
  return files.filter((f) => {
    const n = norm(f).trim();
    if (!n) return false;
    if (/^image\d+\.(png|jpe?g|gif|bmp)$/.test(n)) return false;
    if (/(logo|signature|outlook|banner)/.test(n) && /\.(png|jpe?g|gif|bmp|svg)$/.test(n)) return false;
    if (/\.(gif|svg|ics|vcf)$/.test(n)) return false;
    return true;
  });
}

export function isDocumentMail(m: Pick<MailLite, "from_address" | "to_addresses" | "cc_addresses" | "subject" | "files">): boolean {
  if (!documentAttachments(m.files).length) return false;
  const subj = norm(m.subject);
  const from = norm(m.from_address).trim();
  const rcpt = [...(m.to_addresses ?? []), ...(m.cc_addresses ?? [])].map((a) => norm(a).trim());
  if (DOC_SENDERS.includes(from)) return true;
  if (rcpt.some((a) => DEDICATED_BL.includes(a))) return true;
  if (STRONG_SUBJECT.test(subj) && !EXCLUDE_SUBJECT.test(subj)) return true;
  return false;
}

/** Site effectif déduit des adresses ; null si absent ou ambigu. */
export function effectiveMailSite(
  m: Pick<MailLite, "site_id" | "from_address" | "to_addresses" | "cc_addresses">,
  sites: { id: string; code: string | null }[],
): string | null {
  if (m.site_id) return m.site_id;
  const all = [m.from_address ?? "", ...(m.to_addresses ?? []), ...(m.cc_addresses ?? [])].map((a) => norm(a));
  const codes = new Set<string>();
  if (all.some((a) => a.includes("@garagecastillon.fr"))) codes.add("castillon");
  if (all.some((a) => a.includes("@dda-lalinde.fr"))) codes.add("dda");
  if (codes.size !== 1) return null;
  const code = [...codes][0];
  return sites.find((s) => s.code === code)?.id ?? null;
}

const CLOSED = new Set(["traite", "done", "archived", "clos", "closed", "ignore"]);

export function isOpenRecent(m: Pick<MailLite, "sent_at" | "triage_status">, now = new Date(), days = 60): boolean {
  if (m.triage_status && CLOSED.has(norm(m.triage_status))) return false;
  return new Date(m.sent_at).getTime() >= now.getTime() - days * 86400000;
}

/** File opérationnelle : pertinents, ouverts, 60 jours, filtrés par site actif (site effectif). */
export function operationalMails<T extends MailLite>(
  mails: T[],
  sites: { id: string; code: string | null }[],
  activeSite: string | null,
  now = new Date(),
): (T & { effective_site_id: string | null; files: string[] })[] {
  return mails
    .filter((m) => isOpenRecent(m, now) && isDocumentMail(m))
    .map((m) => ({ ...m, files: documentAttachments(m.files), effective_site_id: effectiveMailSite(m, sites) }))
    .filter((m) => !activeSite || m.effective_site_id === activeSite || m.effective_site_id === null);
}
