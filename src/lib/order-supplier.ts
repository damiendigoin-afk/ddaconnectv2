import { matchSupplier } from "@/lib/parts-site";
import { hardAliasSupplier } from "@/lib/supplier-aliases";

type Sup = { id: string; name: string; active?: boolean | null; notes?: string | null };

/** Fournisseur initial du formulaire : alias codé en dur > identifiant déjà résolu > nom/alias connu. */
export function initialOrderSupplier(extracted: { supplier_id?: string | null; supplier?: string | null }, suppliers: Sup[]): string {
  return hardAliasSupplier(extracted.supplier, suppliers)?.id || extracted.supplier_id?.trim() || matchSupplier(extracted.supplier, suppliers)?.id || "";
}

/** Fournisseur à auto-appliquer quand la liste arrive ; jamais d'écrasement d'un choix manuel. */
export function autoSupplier(current: string, touched: boolean, readName: string | null | undefined, suppliers: Sup[] | undefined): string {
  if (touched || !readName || !suppliers?.length) return current;
  const hard = hardAliasSupplier(readName, suppliers);
  if (hard) return hard.id;
  if (current) return current;
  return matchSupplier(readName, suppliers)?.id ?? current;
}
