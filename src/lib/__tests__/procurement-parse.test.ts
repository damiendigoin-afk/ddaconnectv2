import { describe, expect, it } from "vitest";
import { parseProcurementText, partCount, procurementNeedsAi, fromAiJson } from "@/lib/procurement-parse";
import { confirmText, generationBlocker, generationPlan, orderLineFromProcurement } from "@/lib/procurement-rules";

// Textes reconstitués à partir des documents de recette (pas les fichiers réels).
const ROADIA = `ROADIA PERIGUEUX
12 avenue de Limoges 24000 PERIGUEUX
Procès Verbal d'Expertise
Ce document ne constitue pas un OR
Véhicule : RENAULT GRAND MODUS  Immatriculation : AK-068-CV
LISTE DES PIECES/FORFAITS
Op Libellé Réf. Constr. Qté Prix HT Rem.
E 8200670290 SUPPORT D PC AV 1 54,01 0,00
E 8200757489 GRILLE INF D PC AV 1 60,87 0,00
E 8200224763 FACE AV 1 251,81 0,00
E 7701069732 PHARE D 1 368,57 0,00
E 8200213960 PARE-BOUE AVD PARTIE AV 1 134,10 0,00
E 7701058023 RESERVOIR LAVE VITRE AV 1 98,44 0,00
E 8660005383 BRAS SUSPENSION AVD MOTRI 1 87,31 0,00
E 620224382R PARE CHOC AV 1 456,15 0,00
E 631007942R AILE AVD 1 251,62 0,00
PORT 1 7,50
C CONTROLE TRAIN 1,00
D PROJECTEUR DEPOSEPOSE 0,50
D ROUE 0,30
TOTAL PIECES 1762,88`;

const IXELLIO = `DEVIS 2051 DAMIEN DIGOIN AUTOMOBILE
Véhicule BMW Série 1  Immatriculation : ad717dd
PIÈCES
51117185124 BOUCLIER AV (EQUIP. LAVE PHARES) 1 472,42 472,42
63117181294 PHARE + CLIGNOTANT AV D 1 962,42 962,42
63137253326 FEU REPETITEUR LATERAL D 1 28,56 28,56
63177181288 PHARE AB D 1 146,82 146,82
41127152262 SUPPORT AILE AV D (AV) 1 20,60 20,60
PORT 1 15,00 15,00
AGRAFES 1 12,00 12,00
PLAQUE POLICE 1 35,00 35,00
PRET VDR 1 30,00 30,00
MAIN D'OEUVRE
T1 CARROSSERIE 4,50 h 58,00 261,00
MECANIQUE 1,00 h 62,00 62,00
PEINTURE
INGREDIENTS 1 180,00`;

const AUDI = `EXPERTS GROUPE 24 / EXPAD 24
Rapport d'expertise
Audi A1  Immat. GH-613-SH
LISTE DES PIECES
EP P PC AV 82A807065F GRU 1 833,82
E GRILLE D PC AV 82A807680F Y9B 1 90,64
E SUPPORT INF PROJECTEUR D 82A807572A 1 34,48
E PARE-BOUE AVD 82A809958 AH 1 55,34
E RENFORT AVD'AILE AVD 82A821136 1 20,17
O BRAS SUSPENSION AVD - PQE ASCR-0032444086 1 195,35
O ROTULE BRAS SUSPENSION AVD PQE ASCR-0039651772 1 95,80
E 82A941774 PROJECTEUR D 1 1601,35
E GRILLE DE CALANDRE 82A853651C 3FZ 1 398,56
E ABSORBEUR DE PARE-CHOCS AV 82A807251 1 38,57
E SUPPORT D'AVERTISSEUR SONORE GRAVE 2G0951182C 1 13,09
EP DEFLECTEUR D'AIR DE PARE-CHOCS AV 82A807611 1 54,22
R P AILE AVD 2,50
C CTRL TRAINS 1,00
G PROJECTEURS G/D 0,50
G RADAR DISTANCE 0,50
C CONTROLE SECURITE 0,30
LECTURE DEFAUTS 1 45,00
ESSAI 0,20
CALIBRAGE ADAS 1 120,00
FORF.DIAG 1 60,00
AGRAFES/RIVETS 1 18,00
ERD 1 25,00`;

describe("liste d'approvisionnement — rapport ROADIA", () => {
  const p = parseProcurementText(ROADIA);
  it("9 pièces, PORT en frais, opérations exclues", () => {
    expect(partCount(p)).toBe(9);
    expect(p.lines.filter((l) => l.item_type === "fee").map((l) => l.source_price_ht)).toEqual([7.5]);
    expect(p.lines.some((l) => /CONTROLE|ROUE|PROJECTEUR/.test(l.designation))).toBe(false);
  });
  it("lignes exactes", () => {
    const parts = p.lines.filter((l) => l.item_type === "part");
    expect(parts.map((l) => [l.reference, l.designation, l.quantity, l.source_price_ht])).toEqual([
      ["8200670290", "SUPPORT D PC AV", 1, 54.01],
      ["8200757489", "GRILLE INF D PC AV", 1, 60.87],
      ["8200224763", "FACE AV", 1, 251.81],
      ["7701069732", "PHARE D", 1, 368.57],
      ["8200213960", "PARE-BOUE AVD PARTIE AV", 1, 134.1],
      ["7701058023", "RESERVOIR LAVE VITRE AV", 1, 98.44],
      ["8660005383", "BRAS SUSPENSION AVD MOTRI", 1, 87.31],
      ["620224382R", "PARE CHOC AV", 1, 456.15],
      ["631007942R", "AILE AVD", 1, 251.62],
    ]);
  });
  it("en-tête : expertise, ROADIA émetteur (pas fournisseur), immat, pas d'OR", () => {
    expect(p.source_type).toBe("expertise");
    expect(p.source_label).toBe("ROADIA PERIGUEUX");
    expect(p.plate).toBe("AK-068-CV");
    expect(p.or_number).toBeNull();
    expect(procurementNeedsAi(p, ROADIA)).toBe(false);
  });
});

describe("liste d'approvisionnement — devis Ixellio 2051", () => {
  const p = parseProcurementText(IXELLIO);
  it("5 pièces avec prix source, divers typés, temps exclus", () => {
    const parts = p.lines.filter((l) => l.item_type === "part");
    expect(parts.map((l) => [l.reference, l.source_price_ht])).toEqual([
      ["51117185124", 472.42], ["63117181294", 962.42], ["63137253326", 28.56], ["63177181288", 146.82], ["41127152262", 20.6],
    ]);
    expect(parts[0]!.designation).toBe("BOUCLIER AV (EQUIP. LAVE PHARES)");
    const byName = Object.fromEntries(p.lines.filter((l) => l.item_type !== "part").map((l) => [l.designation, l.item_type]));
    expect(byName).toEqual({ PORT: "fee", AGRAFES: "consumable", "PLAQUE POLICE": "consumable", "PRET VDR": "service" });
  });
  it("en-tête : ixellio, AD-717-DD, émetteur", () => {
    expect(p.source_type).toBe("ixellio");
    expect(p.plate).toBe("AD-717-DD");
    expect(p.source_label).toBe("DAMIEN DIGOIN AUTOMOBILE");
  });
  it("prix source jamais PA dans la commande générée", () => {
    const l = p.lines[0]!;
    expect(orderLineFromProcurement(l).expected_unit_cost_ht).toBeNull();
  });
});

describe("liste d'approvisionnement — expertise Audi A1 (réfs en fin de ligne)", () => {
  const p = parseProcurementText(AUDI);
  it("12 pièces, références de fin de ligne récupérées", () => {
    const parts = p.lines.filter((l) => l.item_type === "part");
    expect(parts.map((l) => [l.reference, l.source_price_ht, l.source_operation])).toEqual([
      ["82A807065F GRU", 833.82, "EP P"],
      ["82A807680F Y9B", 90.64, "E"],
      ["82A807572A", 34.48, "E"],
      ["82A809958 AH", 55.34, "E"],
      ["82A821136", 20.17, "E"],
      ["ASCR-0032444086", 195.35, "O"],
      ["ASCR-0039651772", 95.8, "O"],
      ["82A941774", 1601.35, "E"],
      ["82A853651C 3FZ", 398.56, "E"],
      ["82A807251", 38.57, "E"],
      ["2G0951182C", 13.09, "E"],
      ["82A807611", 54.22, "EP"],
    ]);
    expect(parts[0]!.designation).toBe("PC AV");
    expect(parts[5]!.designation).toBe("BRAS SUSPENSION AVD - PQE");
  });
  it("AILE AVD R P, contrôles, diag : jamais des pièces ; consommables / frais typés", () => {
    expect(p.lines.some((l) => /^AILE AVD$|CTRL|RADAR|CALIBRAGE|DIAG|LECTURE|ESSAI/.test(l.designation))).toBe(false);
    expect(p.lines.find((l) => l.designation === "AGRAFES/RIVETS")?.item_type).toBe("consumable");
    expect(p.lines.find((l) => l.designation === "ERD")?.item_type).toBe("fee");
  });
  it("en-tête : GH-613-SH, cabinet en émetteur", () => {
    expect(p.plate).toBe("GH-613-SH");
    expect(p.source_type).toBe("expertise");
    expect(p.source_label).toContain("EXPERTS GROUPE 24");
  });
});

describe("règles de génération", () => {
  const L = (supplier_id: string | null, gen: string | null = null) => ({ supplier_id, generated_order_id: gen, status: gen ? "ordered" : supplier_id ? "ready" : "to_assign", designation: "X", quantity: 1 });
  it("OR obligatoire", () => {
    expect(generationBlocker({ requested_or_number: null, status: "draft" }, [L("a")])).toMatch(/OR/);
    expect(generationBlocker({ requested_or_number: "50912", status: "draft" }, [L("a")])).toBeNull();
  });
  it("groupe par fournisseur, non affectées en attente, déjà générées ignorées (idempotence)", () => {
    const plan = generationPlan([L("a"), L("a"), L("b"), L(null), L("a", "o1")]);
    expect([...plan.groups].map(([k, v]) => [k, v.length])).toEqual([["a", 2], ["b", 1]]);
    expect(plan.unassigned).toBe(1);
    expect(plan.alreadyOrdered).toBe(1);
    expect(generationBlocker({ requested_or_number: "50912", status: "partial" }, [L("a", "o1"), L(null)])).toMatch(/Aucune ligne prête/);
    expect(confirmText([L("a"), L("b"), L(null)], (id) => id.toUpperCase())).toContain("1 ligne encore non affectée");
  });
  it("ligne sans référence ni prix acceptée, qté 1 par défaut", () => {
    const o = orderLineFromProcurement({ reference: null, designation: "ENJOLIVEUR", quantity: 0, item_type: "part" });
    expect(o).toEqual({ line_kind: "part", physical_reference: null, designation: "ENJOLIVEUR", qty_ordered: 1, expected_unit_cost_ht: null });
    const p = parseProcurementText("LISTE DES PIECES\nE ENJOLIVEUR ROUE AVD\n");
    expect(p.lines[0]).toMatchObject({ designation: "ENJOLIVEUR ROUE AVD", reference: null, quantity: 1, source_price_ht: null, item_type: "part" });
  });
  it("IA : opérations atelier re-filtrées", () => {
    const r = fromAiJson({ lines: [{ designation: "PHARE D", reference: "7701069732", source_operation: "E", source_price_ht: 368.57 }, { designation: "CONTROLE TRAIN", source_operation: "C" }] }, parseProcurementText(""));
    expect(r.lines.map((l) => l.designation)).toEqual(["PHARE D"]);
  });
});
