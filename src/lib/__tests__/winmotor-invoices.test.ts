import { describe, expect, it } from "vitest";
import { classifyLine, decodeBuffer, lineTotals, parseAmount, parseExport, recoverFields, resolveColumns, vatRate } from "@/lib/winmotor/invoices";
import { billingAnomalies, canLink, proposeMatches, type DdaUsage, type Link, type WmLine } from "@/lib/winmotor/reconcile";
import { movementDeltas, applyMovements } from "@/lib/parts-rules";

const DH = "N° facture;Date facture;Numero OR;Numero client;Nom client;Numero client facture;Nom client facture;Immatriculation;VIN;Activite;Type de ligne;Reference;Libelle;Quantite;Prix unitaire HT;Remise;Total net HT;Code TVA;Famille";
const d = (...cols: string[]) => cols.join(";");
const detail = [
  DH,
  d("F1", "02/09/2026", "5001", "C1", "MARTIN", "C9", "ASSUR SA", "AB-123-CD", "VF1AAAAAAAAAAAAAA", "MECA", "En-tête forfait", "", "Forfait vidange", "1", "89,00", "", "89,00", "2", ""),
  d("F1", "02/09/2026", "5001", "C1", "MARTIN", "C9", "ASSUR SA", "AB-123-CD", "VF1AAAAAAAAAAAAAA", "MECA", "Pièce forfait", "8660003780", "Filtre huile", "1", "12,00", "", "12,00", "2", "FILT"),
  d("F1", "02/09/2026", "5001", "C1", "MARTIN", "C9", "ASSUR SA", "AB-123-CD", "VF1AAAAAAAAAAAAAA", "MECA", "Main d’œuvre forfait", "", "MO vidange", "0,5", "60,00", "", "30,00", "8", ""),
  d("F1", "02/09/2026", "5001", "C1", "MARTIN", "C9", "ASSUR SA", "AB-123-CD", "VF1AAAAAAAAAAAAAA", "MECA", "Main d’œuvre", "", "Diagnostic", "1,50", "60,00", "", "90,00", "2", ""),
  d("F1", "02/09/2026", "5001", "C1", "MARTIN", "C9", "ASSUR SA", "AB-123-CD", "VF1AAAAAAAAAAAAAA", "MECA", "Pièce", "BAL1", "Balai", "1", "5,00", "", "5,00", "2", ""),
  d("F1", "02/09/2026", "5001", "C1", "MARTIN", "C9", "ASSUR SA", "AB-123-CD", "VF1AAAAAAAAAAAAAA", "MECA", "Pièce", "BAL1", "Balai", "1", "5,00", "", "5,00", "2", ""),
  d("F2", "05/09/2026", "5001", "C1", "MARTIN", "C1", "MARTIN", "AB-123-CD", "", "MECA", "Pièce", "X1", "Joint; spécial", "1", "3,00", "", "3,00", "0", ""),
  d("F3", "06/09/2026", "5001", "C1", "MARTIN", "C1", "MARTIN", "AB-123-CD", "", "MECA", "Pièce", "X2", "Libellé", "1", "abc", "", "3,00", "0", "", "extra;bad"),
  d("F4", "07/09/2026", "5001", "C1", "MARTIN", "C1", "MARTIN", "AB-123-CD", "", "MECA", "Pièce", "BAL1", "Avoir balai", "-1", "5,00", "", "-5,00", "2", ""),
].join("\r\n");

describe("détail facturation", () => {
  const r = parseExport(detail, "details");
  it("colonnes reconnues", () => expect(r.missing).toEqual([]));
  it("ligne malformée : récupérée si déterministe, rejetée sinon", () => {
    expect(r.recovered).toBe(1);
    expect(r.invoices.find((i) => i.inv === "F2")!.lines[0]!.designation).toBe("Joint; spécial");
    expect(r.rejects.length).toBe(1);
    expect(r.rejects[0]!.raw_text).toContain("extra;bad");
  });
  it("deux lignes identiques légitimes restent deux lignes", () => {
    expect(r.invoices.find((i) => i.inv === "F1")!.lines.filter((l) => l.ref === "BAL1")).toHaveLength(2);
  });
  it("en-tête forfait hors CA et heures ; pièce/MO forfait comptées ; MO décimale", () => {
    const f1 = r.invoices.find((i) => i.inv === "F1")!;
    expect(f1.net_ht).toBe(142);
    expect(f1.hours).toBe(2);
  });
  it("client facturé distinct conservé", () => {
    const f1 = r.invoices.find((i) => i.inv === "F1")!;
    expect(f1.client_no).toBe("C1");
    expect(f1.billed_no).toBe("C9");
  });
  it("OR avec plusieurs factures", () => {
    expect(new Set(r.invoices.filter((i) => i.or === "5001").map((i) => i.inv)).size).toBe(3);
    expect(r.orCount).toBe(1);
  });
  it("hash stable au réimport (idempotence) et sensible au contenu", () => {
    const again = parseExport(detail, "details");
    expect(again.invoices.map((i) => i.lines_hash)).toEqual(r.invoices.map((i) => i.lines_hash));
    const changed = parseExport(detail.replace("Filtre huile\";", "x").replace("12,00;;12,00", "13,00;;13,00"), "details");
    expect(changed.invoices.find((i) => i.inv === "F1")!.lines_hash).not.toBe(r.invoices.find((i) => i.inv === "F1")!.lines_hash);
  });
  it("lignes négatives conservées", () => {
    expect(r.negativeRows).toBe(1);
    expect(r.invoices.find((i) => i.inv === "F4")!.lines[0]!.qty).toBe(-1);
  });
  it("dates min/max observées", () => {
    expect(r.dateMin).toBe("2026-09-02");
    expect(r.dateMax).toBe("2026-09-07");
  });
});

describe("entêtes", () => {
  const H = "N° facture;Date facture;Numero OR;Numero client;Nom client;Numero client facture;Telephone;Portable;Email;Immatriculation;VIN;Marque;Dernier km au compteur;Date de derniere visite;Total HT;Total TVA;Total TTC;Vendeur";
  const txt = [H, "F1;02/09/2026;5001;C1;MARTIN;C9;05 53 00 00 00;06 00 00 00 01;a@b.fr;AB-123-CD;;RENAULT;120000;20/09/2026;100,00;20,00;120,00;LUC", "F0;01/01/2019;4000;C1;MARTIN;C1;;;;AB-123-CD;;RENAULT;120000;20/09/2026;0,00;0,00;0,00;LUC"].join("\n");
  const r = parseExport(txt, "headers");
  it("facture sans détail conservée (0 €)", () => {
    expect(r.headerRows.map((h) => h.inv)).toContain("F0");
  });
  it("dernier km porté comme valeur « dernier connu » avec sa date, identique sur toutes les lignes (non historique)", () => {
    expect(r.headerRows.every((h) => h["last_km"] === 120000 && h["last_visit"] === "2026-09-20")).toBe(true);
    expect(r.headerRows.some((h) => "mileage" in h)).toBe(false);
  });
  it("totaux et contacts normalisés", () => {
    expect(r.sumTtc).toBe(120);
    expect(r.headerRows[0]!["mobile_n"]).toBe("0600000001");
  });
});

describe("utilitaires", () => {
  it("TVA 0/2/8", () => { expect(vatRate("0")).toBe(0); expect(vatRate("2")).toBe(20); expect(vatRate("8")).toBe(20); expect(vatRate("9")).toBeNull(); });
  it("montants FR", () => { expect(parseAmount("1 234,50")).toBe(1234.5); expect(parseAmount("-5,00")).toBe(-5); });
  it("types de lignes", () => {
    expect(classifyLine("En-tête forfait")).toEqual({ kind: "package_header", rev: false, hours: false });
    expect(classifyLine("Main d'oeuvre").hours).toBe(true);
    expect(classifyLine("Pièce forfait").kind).toBe("package_part");
  });
  it("encodage Windows-1252", () => {
    expect(decodeBuffer(new Uint8Array([0x50, 0xe8, 0x63, 0x65])).text).toBe("Pèce");
  });
  it("colonnes manquantes signalées", () => expect(resolveColumns(["Foo"], "details").missing).toContain("inv"));
  it("reconstruction ambiguë rejetée", () => {
    const { map } = resolveColumns(["N° facture", "Nom client", "Libelle", "Total net HT"], "details");
    expect(recoverFields(["F", "A", "B", "C", "1"], 4, map).fields).toBeNull();
  });
  it("lineTotals", () => {
    expect(lineTotals([{ line_kind: "package_header", counts_revenue: false, counts_hours: false, net_ht: 50, qty: 1 }, { line_kind: "labour", counts_revenue: true, counts_hours: true, net_ht: 30, qty: 0.5 }])).toEqual({ ht: 30, hours: 0.5 });
  });
});

describe("rapprochement", () => {
  const line: WmLine = { id: "L1", invoice_id: "F1", line_kind: "part", reference_normalized: "BAL1", designation: "Balai", qty: 2 };
  const u: DdaUsage = { id: "U1", item_kind: "part", physical_reference: "BAL-1", qty_allocated: 3, qty_used: 3, usage_status: "used", article_id: "A" };
  const eq = new Map<string, Set<string>>();
  it("partiel autorisé, pas de suraffectation", () => {
    const links: Link[] = [{ invoice_line_id: "L1", usage_id: "U1", qty: 1, status: "active" }];
    expect(canLink(line, u, 1, links)).toBeNull();
    expect(canLink(line, u, 2, links)).not.toBeNull();
  });
  it("proposition sûre uniquement si candidat unique", () => {
    expect(proposeMatches([line], [u], [], eq).sure).toHaveLength(1);
    const u2 = { ...u, id: "U2" };
    const p = proposeMatches([line], [u, u2], [], eq);
    expect(p.sure).toHaveLength(0);
    expect(p.ambiguous).toContain("L1");
  });
  it("équivalence apprise proposée", () => {
    const e = new Map([["BAL1", new Set(["XYZ9"])]]);
    expect(proposeMatches([line], [{ ...u, physical_reference: "XYZ9" }], [], e).sure[0]!.rule).toBe("equivalence");
  });
  it("facturée non montée => anomalie forte, aucune proposition (pas de mouvement)", () => {
    const pending = { ...u, usage_status: "pending" };
    expect(proposeMatches([line], [pending], [], eq).sure).toHaveLength(0);
    expect(billingAnomalies({ lines: [line], usages: [pending], links: [], eq, hoursBilled: 0, minutesDda: 0 }).map((a) => a.kind)).toContain("facturee_non_montee");
  });
  it("montée non facturée (forte) / consommable (légère) / avoir client à décider", () => {
    const a = billingAnomalies({ lines: [{ ...line, id: "L2", qty: -1 }], usages: [{ ...u, physical_reference: "ZZZ" }, { ...u, id: "C", item_kind: "consumable", physical_reference: "GR" }], links: [], eq, hoursBilled: 1.5, minutesDda: 60 });
    expect(a.find((x) => x.kind === "montee_non_facturee")!.level).toBe("strong");
    expect(a.find((x) => x.kind === "consommable_non_facture")!.level).toBe("light");
    expect(a.find((x) => x.kind === "avoir_client")).toBeTruthy();
    expect(a.find((x) => x.kind === "temps_vs_mo")!.level).toBe("info");
  });
  it("préfacture refusée", () => expect(canLink({ ...line, doc_kind: "preinvoice" }, u, 1, [])).not.toBeNull());
  it("or_sale_final ne touche pas le disponible", () => {
    const l = applyMovements({ available: 0, allocated: 0, quarantine: 0 }, [movementDeltas("receipt_in", 2), movementDeltas("allocate_to_or", 2), movementDeltas("or_sale_final", 2)]);
    expect(l).toEqual({ available: 0, allocated: 0, quarantine: 0 });
  });
});
