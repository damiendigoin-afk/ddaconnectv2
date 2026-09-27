import { matchSupplier } from "@/lib/parts-site";

/** Fournisseur à auto-appliquer quand la liste arrive ; jamais d'écrasement d'un choix manuel. */
export function autoSupplier(current: string, touched: boolean, readName: string | null | undefined, suppliers: { id: string; name: string }[] | undefined): string {
  if (touched || current || !readName || !suppliers?.length) return current;
  return matchSupplier(readName, suppliers as never)?.id ?? current;
}
