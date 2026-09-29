import { matchSupplier } from "@/lib/parts-site";

/** Fournisseur initial du formulaire : identifiant déjà résolu, sinon nom/alias connu. */
export function initialOrderSupplier(
  extracted: { supplier_id?: string | null; supplier?: string | null },
  suppliers: { id: string; name: string; notes?: string | null }[],
): string {
  return extracted.supplier_id ?? matchSupplier(extracted.supplier, suppliers)?.id ?? "";
}

/** Fournisseur à auto-appliquer quand la liste arrive ; jamais d'écrasement d'un choix manuel. */
export function autoSupplier(current: string, touched: boolean, readName: string | null | undefined, suppliers: { id: string; name: string }[] | undefined): string {
  if (touched || current || !readName || !suppliers?.length) return current;
  return matchSupplier(readName, suppliers as never)?.id ?? current;
}
