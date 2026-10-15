/** Modal « Commander chez DC » : commande INTERNE à transmettre + ouverture manuelle du portail. */
import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useAuth } from "@/lib/auth";
import { useSite } from "@/lib/site-context";
import { districashPortalLink, type SevenOffer } from "@/lib/tires";
import { districashAccountForSite, tireOrderLine, tireOrderSource, validateTireOrderTarget } from "@/lib/tire-supplier-order";
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

  async function submit() {
    if (!site) return toast.error("Choisissez un site.");
    const err = validateTireOrderTarget({ orNumber, plate });
    if (err) return toast.error(err);
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
            <p>Commande enregistrée au statut <b>« À transmettre »</b>. Validez-la sur Districash, puis saisissez le n° de commande Districash sur la fiche commande pour la passer en « Commandée ».</p>
            {link ? <a href={link.url} target="_blank" rel="noopener noreferrer" className="block font-semibold underline">{link.label} ↗</a> : null}
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
