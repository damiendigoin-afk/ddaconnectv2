/**
 * Modal « Commander chez DC » : un seul champ (OR ou immat) + une seule validation
 * → commande interne « À transmettre » puis ajout serveur au panier Districash du site de la commande.
 * Jamais de validation de commande fournisseur.
 */
import { useEffect, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import { Check, Copy, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useAuth } from "@/lib/auth";
import { useSite } from "@/lib/site-context";
import { districashPortalLink, type SevenOffer } from "@/lib/tires";
import { districashAccountForSite, districashCartLabel, districashCartPrefillUrl, districashCartFields, parseOrderTarget, tireOrderLine, tireOrderSource } from "@/lib/tire-supplier-order";

function CopyIcon({ label, value }: { label: string; value: string }) {
  const [done, setDone] = useState(false);
  const title = done ? `${label} copiée` : `Copier ${label.toLowerCase()}`;
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md hover:bg-muted focus-visible:outline focus-visible:outline-2"
      onClick={() => void navigator.clipboard.writeText(value).then(() => { setDone(true); setTimeout(() => setDone(false), 1500); }, () => toast.error("Copie impossible"))}
    >
      {done ? <Check className="h-4 w-4 text-brand" aria-hidden /> : <Copy className="h-4 w-4" aria-hidden />}
      <span className="sr-only" aria-live="polite">{done ? "Copié" : ""}</span>
    </button>
  );
}
import { addOrderToDistricashCart } from "@/lib/districash-cart.functions";
import { createTireSupplierOrder, districashSupplierId, findDuplicateTireOrder, lookupKnownOr } from "@/lib/tire-supplier-order-db";

const input = "h-10 w-full rounded-lg border border-border bg-background px-3 text-sm";
const eur = (v: number) => `${v.toFixed(2).replace(".", ",")} €`;
type CartRes = { status: string; message: string };

/** L'extension facultative pose un attribut sur la page DDA ; sans lui on ne prétend rien. */
function useExtensionVersion(): string | null {
  const [v, setV] = useState<string | null>(null);
  useEffect(() => {
    const read = () => setV(document.documentElement.getAttribute("data-dda-districash-ext"));
    read();
    const t = setTimeout(read, 500);
    return () => clearTimeout(t);
  }, []);
  return v;
}

export function TireOrderDialog({ offer, size, quoteId, defaultPlate, onClose }: { offer: SevenOffer; size: string; quoteId: string | null; defaultPlate: string | null; onClose: () => void }) {
  const { site } = useSite();
  const { user, displayName } = useAuth();
  const ext = useExtensionVersion();
  const [target, setTarget] = useState(defaultPlate ?? "");
  const [step, setStep] = useState<"form" | "order" | "cart" | "done">("form");
  const [dup, setDup] = useState<string | null>(null);
  const [orderId, setOrderId] = useState<string | null>(null);
  const [fields, setFields] = useState<{ orNumber: string; plate: string } | null>(null);
  const [orderSite, setOrderSite] = useState<{ id: string; label: string | null } | null>(null);
  const [res, setRes] = useState<CartRes | null>(null);
  const lock = useRef(false);
  const line = tireOrderLine(offer);
  const account = districashAccountForSite(site?.code);
  const label = districashCartLabel(site?.code);
  const link = districashPortalLink(offer);
  const parsed = parseOrderTarget(target);

  /** Onglet ouvert pendant le clic (sinon bloqué par le navigateur après l'attente serveur). */
  function preopenTab(): Window | null {
    const w = window.open("", "_blank");
    if (!w) return null;
    try { w.opener = null; w.document.title = "Panier Districash"; w.document.body.textContent = "DDA Connect : ajout au panier Districash en cours…"; } catch { /* ignore */ }
    return w;
  }

  async function addToCart(id: string, siteId: string, f: { orNumber: string; plate: string }, tab: Window | null, allowExistingInCart: boolean) {
    setStep("cart");
    let r: CartRes;
    try { r = await addOrderToDistricashCart({ data: { orderId: id, siteId, confirmed: true, allowExistingInCart } }); }
    catch { r = { status: "uncertain", message: "Erreur réseau pendant l'ajout : vérifiez le panier Districash, sans relancer." }; }
    setRes(r);
    setStep("done");
    if (tab) {
      if (r.status === "added" || r.status === "uncertain") tab.location.href = districashCartPrefillUrl(f);
      else tab.close();
    }
  }

  async function validate(forceDup = false) {
    if (lock.current) return;
    if (!site) { toast.error("Choisissez un site."); return; }
    if ("error" in parsed) { toast.error(parsed.error); return; }
    lock.current = true;
    const tab = preopenTab();
    try {
      setStep("order");
      const supplierId = await districashSupplierId();
      if (!supplierId) throw new Error("Fournisseur Districash introuvable dans la base fournisseurs.");
      let or = null;
      const f = { ...parsed };
      if (f.orNumber) {
        or = await lookupKnownOr(f.orNumber, site.id);
        if (!or) throw new Error(`OR ${f.orNumber} inconnu sur ${site.name} : saisissez plutôt l'immatriculation (aucun OR n'est créé par DDA).`);
        if (or.plate) f.plate = or.plate.toUpperCase().replace(/[^A-Z0-9]/g, "");
      }
      if (!forceDup) {
        const d = await findDuplicateTireOrder({ siteId: site.id, supplierId, ref: line.physical_reference, orNumber: f.orNumber, plate: f.plate });
        if (d) { setDup(d.id); setStep("form"); tab?.close(); return; }
      }
      const id = await createTireSupplierOrder({ siteId: site.id, supplierId, account, orNumber: f.orNumber, plate: f.plate, or, line, source: tireOrderSource(offer, { quoteId, size, consultedAt: offer.consultedAt }) }, { userId: user?.id ?? null, name: displayName ?? "" });
      const os = { id: site.id, label };
      setOrderId(id); setFields(f); setOrderSite(os);
      await addToCart(id, os.id, f, tab, false);
    } catch (e) {
      tab?.close();
      setStep("form");
      toast.error(e instanceof Error ? e.message : "Enregistrement impossible.");
    } finally {
      lock.current = false;
    }
  }

  async function retry(allowExisting: boolean) {
    if (lock.current || !orderId || !orderSite || !fields) return;
    lock.current = true;
    const tab = preopenTab();
    try { await addToCart(orderId, orderSite.id, fields, tab, allowExisting); } finally { lock.current = false; }
  }

  const busy = step === "order" || step === "cart";
  const cart = fields ? districashCartFields(fields) : null;

  return (
    <Dialog open onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Commander chez DC</DialogTitle>
          <DialogDescription>Commande interne + ajout au panier Districash. Aucune commande fournisseur n'est validée.</DialogDescription>
        </DialogHeader>

        {step === "done" && orderId && res ? (
          <div className="space-y-3 text-sm">
            <p className={`rounded-lg border p-2 text-xs ${res.status === "added" ? "border-brand" : "border-destructive"}`}>
              ✓ Commande interne enregistrée « À transmettre ».<br />{res.message}
              {res.status === "refused" ? " Aucun envoi n'a eu lieu : vous pouvez réessayer." : ""}
              {res.status === "uncertain" ? " Ne relancez pas : vérifiez le panier." : ""}
            </p>
            {res.status === "refused" ? <button type="button" onClick={() => void retry(false)} className="h-10 w-full rounded-lg border border-border font-bold">Réessayer l'ajout au panier</button> : null}
            {res.status === "already_in_cart" ? <button type="button" onClick={() => void retry(true)} className="h-10 w-full rounded-lg border border-border font-bold">Ajouter quand même ({line.qty_ordered} pneu(s))</button> : null}
            {cart ? (
              <div className="space-y-1">
                {([["Référence de commande", cart.reference], ["Immatriculation", cart.immatriculation]] as const).map(([l, v]) =>
                  v ? (
                    <div key={l} className="flex items-center justify-between gap-2 rounded-lg border border-border px-3 py-2">
                      <span className="text-xs"><b>{l}</b> : {v}</span>
                      <CopyIcon label={l} value={v} />
                    </div>
                  ) : null,
                )}
              </div>
            ) : null}
            <p className="text-[11px] text-muted-foreground">
              {ext
                ? `Extension DDA détectée (v${ext}) : ces champs sont remplis dans le panier ouvert, à vérifier avant validation.`
                : "Extension DDA non détectée : Districash ne permet pas à DDA d'écrire dans sa page. Copiez ces deux champs dans le panier."}{" "}
              Votre Chrome doit être connecté au compte Districash {orderSite?.label ?? ""}.
            </p>
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
              {fields ? <a href={districashCartPrefillUrl(fields)} target="_blank" rel="noopener noreferrer" className="font-semibold underline">Ouvrir le panier {orderSite?.label ?? ""} ↗</a> : null}
              {link ? <a href={link.url} target="_blank" rel="noopener noreferrer" className="underline">{link.label} ↗</a> : null}
            </div>
            <Link to="/pieces-achats/commande/$orderId" params={{ orderId }} className="block h-10 rounded-lg bg-brand text-center font-bold leading-10 text-brand-foreground">Ouvrir la commande</Link>
          </div>
        ) : (
          <div className="space-y-3 text-sm">
            <label className="block">
              <span className="text-xs font-semibold">N° OR ou immatriculation</span>
              <input className={input} autoFocus value={target} disabled={busy} onChange={(e) => { setTarget(e.target.value); setDup(null); }} onKeyDown={(e) => { if (e.key === "Enter" && !busy) void validate(); }} placeholder="78546 ou EE-111-EE" />
              {target.trim() && "error" in parsed ? <span className="text-[11px] text-destructive">{parsed.error}</span> : null}
              {"orNumber" in parsed && parsed.orNumber ? <span className="text-[11px] text-muted-foreground">Référence : OR: {parsed.orNumber}</span> : null}
              {"plate" in parsed && parsed.plate ? <span className="text-[11px] text-muted-foreground">Immatriculation : {parsed.plate}</span> : null}
            </label>
            <div className="rounded-lg border border-border p-3 text-xs space-y-0.5">
              <div className="font-bold">Panier {label ?? "— compte non défini"}</div>
              <div>{offer.brand} {offer.model ?? ""} · {size}</div>
              <div>Qté {line.qty_ordered} · PA HT {eur(line.expected_unit_cost_ht)} / pneu</div>
            </div>
            {dup ? (
              <div className="rounded-lg border border-destructive p-2 text-xs space-y-1">
                <div>Une commande existe déjà pour ce pneu et ce repère.</div>
                <div className="flex gap-3">
                  <Link to="/pieces-achats/commande/$orderId" params={{ orderId: dup }} className="font-semibold underline">Ouvrir l'existante</Link>
                  <button type="button" className="font-semibold underline" disabled={busy} onClick={() => void validate(true)}>Créer quand même</button>
                </div>
              </div>
            ) : null}
            {!ext ? (
              <p className="text-[11px] text-muted-foreground">
                Facultatif : pour remplir automatiquement « Référence de commande » dans le panier, installez une fois l'<a href="/dda-districash-prefill.zip" download className="underline">extension Chrome DDA</a> (décompresser, chrome://extensions → Mode développeur → Charger l'extension non empaquetée). L'ajout au panier fonctionne sans elle.
              </p>
            ) : null}
            <button type="button" disabled={busy || !label || "error" in parsed || !!dup} onClick={() => void validate()} className="flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-brand font-bold text-brand-foreground disabled:opacity-50">
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              {step === "order" ? "Enregistrement de la commande…" : step === "cart" ? `Ajout au panier ${label ?? ""}…` : "Valider et ajouter au panier"}
            </button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
