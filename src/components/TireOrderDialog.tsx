/** Modal « Commander chez DC » : commande INTERNE à transmettre + ouverture manuelle du portail. */
import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { Check, Copy, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useAuth } from "@/lib/auth";
import { useSite } from "@/lib/site-context";
import { districashPortalLink, type SevenOffer } from "@/lib/tires";
import { districashAccountForSite, districashCartPrefillUrl, districashCartFields, tireOrderLine, tireOrderSource, validateTireOrderTarget } from "@/lib/tire-supplier-order";

/**
 * Ajout au panier dans la session du NAVIGATEUR via l'extension DDA (volontaire).
 * Le panier Districash est propre à chaque session : un ajout fait par le serveur DDA n'apparaît pas
 * dans le panier de l'utilisateur (constaté le 16/10/2026). Le serveur n'ajoute donc plus rien.
 */
function BrowserCartAdd({ orderId, siteId, account, url, qty, price }: { orderId: string; siteId: string; account: string | null; url: string | null; qty: number; price: string }) {
  const [opened, setOpened] = useState(false);
  if (!url) return <p className="rounded-lg border border-border p-2 text-xs">Fiche produit Districash non fiable : ajoutez l'article manuellement sur le portail.</p>;
  function open() {
    window.open(url!, "_blank", "noopener,noreferrer");
    setOpened(true);
    // Trace d'intention uniquement (jamais une preuve d'ajout).
    void supabase.from("parts_events").insert({ site_id: siteId, entity: "part_order", entity_id: orderId, action: "cart_browser_handoff", detail: { supplier: "districash", account } as never });
  }
  return (
    <div className="space-y-2 rounded-lg border border-border p-3 text-xs">
      <div className="font-bold">Ajouter au panier dans votre navigateur</div>
      <p>Ouvre votre panier Districash (compte {account}). L'extension DDA affiche un encadré : cochez l'accord, puis « Ajouter au panier » ({qty} pneu(s) à {price} HT). Elle relit le panier et remplit la référence et l'immatriculation. Aucune commande n'est validée.</p>
      <button type="button" onClick={open} className="flex h-10 w-full items-center justify-center rounded-lg border border-border font-bold">
        Ouvrir et ajouter au panier ↗
      </button>
      {opened ? <p className="text-muted-foreground">Vérifiez le résultat affiché dans l'onglet Districash. La commande reste « À transmettre ».</p> : null}
      <p className="text-[11px] text-muted-foreground">Nécessite l'extension DDA (v1.1) et d'être connecté à Districash dans ce navigateur. Sans extension, rien n'est ajouté : ajoutez l'article depuis la fiche produit.</p>
    </div>
  );
}

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

export function TireOrderDialog({ offer, size, quoteId, defaultPlate, onClose }: { offer: SevenOffer; size: string; quoteId: string | null; defaultPlate: string | null; onClose: () => void }) {
  const { site } = useSite();
  const { user, displayName } = useAuth();
  const [orNumber, setOrNumber] = useState("");
  const [plate, setPlate] = useState(defaultPlate ?? "");
  const [ack, setAck] = useState(false);
  const [dup, setDup] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [created, setCreated] = useState<string | null>(null);
  const line = tireOrderLine(offer);
  const account = districashAccountForSite(site?.code);
  const link = districashPortalLink(offer);
  const cart = districashCartFields({ orNumber, plate });

  async function submit() {
    if (!site) { toast.error("Choisissez un site."); return; }
    const err = validateTireOrderTarget({ orNumber, plate });
    if (err) { toast.error(err); return; }
    setBusy(true);
    try {
      const supplierId = await districashSupplierId();
      if (!supplierId) throw new Error("Fournisseur Districash introuvable dans la base fournisseurs.");
      let or = null;
      if (orNumber.trim()) {
        or = await lookupKnownOr(orNumber, site.id);
        if (!or && !plate.trim()) throw new Error("OR inconnu sur ce site : ajoutez l'immatriculation (aucun OR ne sera créé).");
      }
      if (!dup) {
        const d = await findDuplicateTireOrder({ siteId: site.id, supplierId, ref: line.physical_reference, orNumber, plate });
        if (d) { setDup(d.id); setBusy(false); return; }
      }
      const id = await createTireSupplierOrder({ siteId: site.id, supplierId, account, orNumber, plate, or, line, source: tireOrderSource(offer, { quoteId, size, consultedAt: offer.consultedAt }) }, { userId: user?.id ?? null, name: displayName ?? "" });
      setCreated(id);
      if (link) window.open(link.url, "_blank", "noopener,noreferrer");
      toast.success("Commande interne enregistrée — à valider sur Districash.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Enregistrement impossible.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Commander chez DC</DialogTitle>
          <DialogDescription>
            Commande <b>interne</b> + validation manuelle sur le portail Districash. Aucune commande automatique n'est envoyée.
          </DialogDescription>
        </DialogHeader>
        {created ? (
          <div className="space-y-3 text-sm">
            <p>Commande interne <b>« À transmettre »</b>, non envoyée à Districash. Sur le portail : ajoutez l'article au panier, vérifiez-le, puis collez les champs ci-dessous.</p>
            <CartAdd orderId={created} account={account} qty={line.qty_ordered} price={eur(line.expected_unit_cost_ht)} />
            <div className="rounded-lg border border-border p-3 text-xs space-y-1">
              <div className="font-bold">À vérifier dans le panier</div>
              <div>Compte {account} · {line.physical_reference}</div>
              <div>Qté {line.qty_ordered} · PA HT attendu {eur(line.expected_unit_cost_ht)} / pneu</div>
            </div>
            {([["Référence de commande", cart.reference], ["Immatriculation", cart.immatriculation]] as const).map(([label, value]) =>
              value ? (
                <div key={label} className="flex items-center justify-between gap-2 rounded-lg border border-border px-3 py-2">
                  <span className="text-xs"><b>{label}</b> : {value}</span>
                  <CopyIcon label={label} value={value} />
                </div>
              ) : null,
            )}
            <div className="flex flex-wrap gap-x-4 gap-y-1">
              {link ? <a href={link.url} target="_blank" rel="noopener noreferrer" className="font-semibold underline">{link.label} ↗</a> : null}
              <a href={districashCartPrefillUrl({ orNumber, plate })} target="_blank" rel="noopener noreferrer" className="font-semibold underline">Ouvrir le panier Districash ↗</a>
            </div>
            <p className="text-[11px] text-muted-foreground">Sans l'extension DDA, collez les deux champs vous-même. <a href="/dda-districash-prefill.zip" download className="underline">Extension Chrome de préremplissage</a> (décompresser, puis chrome://extensions → mode développeur → Charger l'extension non empaquetée).</p>
            <p className="text-[11px] text-muted-foreground">Une fois la commande validée sur Districash, saisissez son n° sur la fiche commande pour passer en « Commandée ».</p>
            <Link to="/pieces-achats/commande/$orderId" params={{ orderId: created }} className="block h-10 rounded-lg bg-brand text-center font-bold leading-10 text-brand-foreground">Ouvrir la commande</Link>
          </div>
        ) : (
          <div className="space-y-3 text-sm">
            <div className="rounded-lg border border-border p-3 text-xs">
              <div className="font-bold">{site?.name ?? "—"} · compte Districash {account ?? "non défini"}</div>
              <div>{line.designation}</div>
              <div className="text-muted-foreground">Réf. {line.physical_reference} · {offer.availability ?? ""}</div>
              <div>Qté {line.qty_ordered} · PA HT interne {eur(line.expected_unit_cost_ht)} / pneu</div>
            </div>
            <label className="block text-xs font-bold">N° OR WinMotor
              <input className={input} inputMode="numeric" value={orNumber} onChange={(e) => { setOrNumber(e.target.value); setDup(null); }} placeholder="ex. 17264" />
            </label>
            <label className="block text-xs font-bold">Immatriculation
              <input className={input} value={plate} onChange={(e) => { setPlate(e.target.value.toUpperCase()); setDup(null); }} placeholder="AB-123-CD" />
            </label>
            <p className="text-[11px] text-muted-foreground">OR et/ou immatriculation obligatoire. Un OR connu est rattaché ; aucun OR n'est créé.</p>
            {dup ? (
              <p className="rounded-lg border border-destructive p-2 text-xs">
                Une commande Districash de cette référence existe déjà pour cet OR / véhicule.{" "}
                <Link to="/pieces-achats/commande/$orderId" params={{ orderId: dup }} className="font-bold underline">Voir</Link>. Validez à nouveau pour créer quand même.
              </p>
            ) : null}
            <label className="flex items-start gap-2 text-xs">
              <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} className="mt-0.5" />
              Je confirme cette commande interne et la validerai moi-même sur le portail Districash.
            </label>
            <button type="button" disabled={!ack || busy || !site || !account} onClick={() => void submit()} className="flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-brand font-bold uppercase text-brand-foreground disabled:opacity-50">
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              {dup ? "Créer malgré le doublon" : "Enregistrer et ouvrir Districash"}
            </button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
