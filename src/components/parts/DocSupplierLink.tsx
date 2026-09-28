/**
 * Identification du fournisseur d'un document importé, dès l'import :
 * fiche trouvée => rattachement automatique ; inconnue => création rapide préremplie ;
 * plusieurs fiches proches => choix manuel (aucune création en double).
 */
import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { btnPrimary, inputCls, useSuppliers } from "@/components/parts/PartsUi";
import { linkDocSupplier, type InvoiceExtract } from "@/lib/supplier-docs";
import { resolveSupplier, supplierDraftFromExtract, type SupplierDraft } from "@/lib/supplier-identify";
import { createSupplierFromDraft } from "@/lib/suppliers";

const FIELDS: { k: keyof SupplierDraft; label: string; wide?: boolean }[] = [
  { k: "name", label: "Nom *", wide: true },
  { k: "address", label: "Adresse", wide: true },
  { k: "postal_code", label: "CP" },
  { k: "city", label: "Ville" },
  { k: "phone", label: "Téléphone" },
  { k: "email", label: "E-mail" },
  { k: "siret", label: "SIRET / SIREN" },
  { k: "vat_number", label: "TVA intracom" },
];

export function DocSupplierLink({ extracted, docId, onLinked }: { extracted: InvoiceExtract; docId?: string | null; onLinked?: (supplierId: string) => void }) {
  const qc = useQueryClient();
  const suppliers = useSuppliers();
  const list = suppliers.data ?? [];
  const [linkedId, setLinkedId] = useState<string | null>(extracted.supplier_id ?? null);
  const [draft, setDraft] = useState<SupplierDraft>(() => supplierDraftFromExtract(extracted));
  const [pick, setPick] = useState("");
  const [busy, setBusy] = useState(false);
  const autoDone = useRef(false);

  async function link(id: string, name?: string | null) {
    if (docId) await linkDocSupplier(docId, id, name);
    setLinkedId(id);
    onLinked?.(id);
    void qc.invalidateQueries({ queryKey: ["pending-docs"] });
    void qc.invalidateQueries({ queryKey: ["supplier-docs"] });
  }

  const linked = linkedId ? list.find((s) => s.id === linkedId) : null;
  const res = suppliers.data ? resolveSupplier(extracted.supplier, list) : null;

  // Fiche existante sûre : rattachement automatique, une seule fois.
  useEffect(() => {
    if (autoDone.current || linkedId || !res || res.kind !== "found") return;
    autoDone.current = true;
    void link(res.supplier.id, res.supplier.name).catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [res?.kind, linkedId]);

  // Rattachement déjà présent : prévenir le parent (préselection du formulaire).
  useEffect(() => {
    if (linkedId) onLinked?.(linkedId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!suppliers.data) return null;
  if (linked) return <p className="text-xs">Fournisseur : <b>{linked.name}</b> <span className="font-bold text-success">✓ fiche rattachée</span></p>;
  if (!res || res.kind === "none") return null;
  if (res.kind === "found") return <p className="text-xs">Fournisseur : <b>{res.supplier.name}</b></p>;

  if (res.kind === "ambiguous") {
    return (
      <div className="space-y-1 rounded-lg border-2 border-warning p-2 text-xs">
        <p><b>« {extracted.supplier} »</b> ressemble à plusieurs fiches : choisissez la bonne.</p>
        <div className="flex gap-2">
          <select className={inputCls} value={pick} onChange={(e) => setPick(e.target.value)}>
            <option value="">— Fiche fournisseur —</option>
            {res.candidates.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <button type="button" className={btnPrimary} disabled={!pick || busy} onClick={async () => { setBusy(true); try { await link(pick); } catch (e) { toast.error(e instanceof Error ? e.message : "Rattachement impossible"); } finally { setBusy(false); } }}>Rattacher</button>
        </div>
      </div>
    );
  }

  async function create() {
    if (draft.name.trim().length < 3) return void toast.error("Nom du fournisseur obligatoire.");
    setBusy(true);
    try {
      const r = await createSupplierFromDraft(draft);
      if (!r.id) return void toast.error(r.ambiguous ? "Plusieurs fiches proches existent : choisissez-la dans la liste." : "Nom du fournisseur insuffisant.");
      await qc.invalidateQueries({ queryKey: ["suppliers-list"] });
      await link(r.id, draft.name);
      toast.success(r.created ? `Fiche « ${draft.name} » créée et rattachée` : "Fiche existante rattachée");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Création impossible");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-2 rounded-lg border-2 border-warning p-2 text-xs">
      <p><b>Nouveau fournisseur</b> : « {extracted.supplier} » n'existe pas encore. Vérifiez la fiche préremplie puis créez-la.</p>
      <div className="grid grid-cols-2 gap-2">
        {FIELDS.map((f) => (
          <label key={f.k} className={f.wide ? "col-span-2" : ""}>
            <span className="font-bold text-muted-foreground">{f.label}</span>
            <input className={inputCls} value={draft[f.k]} onChange={(e) => setDraft({ ...draft, [f.k]: e.target.value })} />
          </label>
        ))}
      </div>
      <button type="button" className={btnPrimary} disabled={busy} onClick={create}>{busy ? "Création…" : "Créer la fiche et rattacher"}</button>
    </div>
  );
}
