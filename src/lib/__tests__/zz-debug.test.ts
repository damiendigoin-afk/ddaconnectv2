import { it } from "vitest";
import { mergeRenaultAi } from "@/lib/renault-order";
import { normalizePurchaseExtract } from "@/lib/purchase-extract";
import { orderFormLinesFromDoc } from "@/lib/receipt-lines";
import { purchaseRules } from "@/lib/doc-rules";
import { RENAULT_46104548_REAL } from "./fixtures/renault-46104548-real";
const ai = {"supplier":"RENAULT SARLAT - GROUPE FAURIE","order_reference":"46104548","or_number":"50969","plate":"EW814BC","lines":[{"reference":"8660004937","label":"MOTRIO Filtre d'habitacle -Pol","quantity":1,"unit_price":11.64},{"reference":"8660003779","label":"MOTRIO Filtre à huile","quantity":1,"unit_price":6.77}],"total_ht":18.41,"vat_amount":3.68,"total_ttc":22.09};
it("dbg", () => {
  for (const base of [{ template: "renault_detail_commande", lines: [] }, purchaseRules(RENAULT_46104548_REAL)!]) {
    const m = mergeRenaultAi(base as never, ai as never);
    const n = normalizePurchaseExtract(m);
    console.log(JSON.stringify(m.lines), JSON.stringify(n.lines), JSON.stringify(orderFormLinesFromDoc(n as never)));
    const n2 = normalizePurchaseExtract(JSON.parse(JSON.stringify(n)));
    console.log("client", JSON.stringify(orderFormLinesFromDoc(n2 as never)));
  }
});
