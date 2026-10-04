import { describe, it, expect } from "vitest";
import { resolveOrLink, usagesToCreate, type LinkOrder } from "../or-link-rules";

const CAST = "castillon", BERG = "bergerac";
const or50912 = { id: "or-50912", site_id: CAST, or_number: "50912" };
const order = (p: Partial<LinkOrder> = {}): LinkOrder => ({ id: "f81a", site_id: CAST, status: "received", destination: "or", repair_order_id: null, requested_or_number: "50912", ...p });
const line = { id: "rl1", article_id: "a1", qty_received: 1, qty_allocated: 0 };
const stock = () => 1;

describe("chaînage commande -> OR", () => {
  it("50912 historique reçu : lié à l'OR du site, pièce à pointer qté 1", () => {
    expect(resolveOrLink(order(), [or50912])).toBe("or-50912");
    expect(usagesToCreate([line], [], stock)).toEqual([{ receipt_line_id: "rl1", qty_allocated: 1, usage_status: "pending" }]);
  });
  it("nouvelle commande simplifiée reçue : plusieurs lignes, partielle", () => {
    const u = usagesToCreate([line, { id: "rl2", article_id: "a2", qty_received: 3, qty_allocated: 1 }], [], () => 5);
    expect(u.map((x) => x.qty_allocated)).toEqual([1, 2]);
  });
  it("idempotence : ligne déjà affectée => rien", () => {
    expect(usagesToCreate([line], [{ receipt_line_id: "rl1" }], stock)).toEqual([]);
  });
  it("OR ambigu ou autre site => pas de lien", () => {
    expect(resolveOrLink(order(), [or50912, { id: "x", site_id: CAST, or_number: "050912" }])).toBeNull();
    expect(resolveOrLink(order(), [{ ...or50912, site_id: BERG }])).toBeNull();
    expect(resolveOrLink(order(), [])).toBeNull();
  });
  it("commande annulée ignorée ; lien existant conservé", () => {
    expect(resolveOrLink(order({ status: "cancelled" }), [or50912])).toBeNull();
    expect(resolveOrLink(order({ repair_order_id: "or-autre" }), [or50912])).toBe("or-autre");
  });
  it("jamais d'affectation forcée sans stock ni pièce abîmée", () => {
    expect(usagesToCreate([line], [], () => 0)).toEqual([]);
    expect(usagesToCreate([{ ...line, condition: "damaged" }], [], stock)).toEqual([]);
  });
});
