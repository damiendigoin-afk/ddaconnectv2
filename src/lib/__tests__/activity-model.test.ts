import { beforeEach, describe, expect, it, vi } from "vitest";

import { apvSubKey } from "@/lib/activity/indicators";
import { parseSheet, parseWorkbookSheets } from "@/lib/activity/parse";
import { currentFiscalYear, fiscalYearLabel, fiscalYearRange } from "@/lib/activity/fiscal";

const rpc = vi.fn();
const from = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: (...args: unknown[]) => rpc(...args),
    from: (...args: unknown[]) => from(...args),
  },
}));

/** Structure fidèle des derniers onglets 2026 (DDA0826). */
const dda0826: unknown[][] = [
  ["SAS DAMIEN DIGOIN AUTOMOBILE"],
  ["Suivi mensuel", "AOÛT 2026"],
  ["", "S APV", "Atelier", "Cession", "Garantie"],
  ["MO Mécanique", 15444, 15170, 0, 274],
  ["MO Tôlerie et peinture", 3455, 3455, 0, 0],
  ["C.A. M.O.", 20899, 20626, 0, 274],
  ["PR Constructeur", 7510, 6985, 0, 524],
  ["Pneumatiques", 3000, 3000, 0, 0],
  ["Total C.A.", 51646, 50848, 0, 798],
  ["Marge APV"],
  ["MO", 12000],
  ["ST ~25%", 500],
  ["Autres", 300],
  ["Total MO", 12800],
  ["PR ~25%", 1800],
  ["Pneus 5%", 150],
  ["Huiles 50%", 400],
  ["Total PR", 2350],
  ["Total Gain APV", 15150],
  ["RESULTAT", 4200],
  ["NB PRODUCTIFS", 6],
  ["Heures"],
  ["Achetées", 900],
  ["Passées", 850],
  ["Facturées", 800],
  ["Réalisation", "94%"],
  ["Entrées (vs n-1)"],
  ["Payantes", 210],
  ["Toutes", 260],
  ["Autres charges ext"],
  ["Loyer bâtiment", 3000],
  ["Assurance", 0],
  ["Honoraires", ""],
  ["Achats non stockés mat&fournitures"],
  ["ELEC", 800],
  ["Subventions/Impots/Taxes/Salaires/Chg"],
  ["Salaires", 25000],
  ["Charges", 9000],
  ["VENTE VEHICULES"],
  ["Marge brute VO", 4000],
  ["Ligne maison non prévue", 42],
];

const casti0826: unknown[][] = [
  ["SAS CASTILLON-VEYSSIERE"],
  ["", "S APV", "Atelier", "Cession", "Garantie"],
  ["MO Mécanique", 9100, 8800, 100, 200],
  ["C.A. M.O.", 11000, 10700, 100, 200],
  ["PR Constructeur", 4200, 4000, 0, 200],
  ["Total C.A.", 26000, 25700, 100, 200],
  ["Heures"],
  ["Achetées", 500],
  ["Passées", 480],
  ["Facturées", 460],
];

describe("parsing contextuel du modèle réel", () => {
  const { month, anomalies } = parseSheet("DDA0826", dda0826, "dda");
  const v = month?.values ?? {};

  it("CA : valeur S APV principale et ventilation Atelier/Cession/Garantie", () => {
    expect(v["ca_total"]).toBe(51646);
    expect(v["ca_mo"]).toBe(20899);
    expect(v["mo_mecanique"]).toBe(15444);
    expect(v["pr_constructeur"]).toBe(7510);
    expect(v[apvSubKey("mo_mecanique", "atelier")]).toBe(15170);
    expect(v[apvSubKey("mo_mecanique", "garantie")]).toBe(274);
    expect(v[apvSubKey("ca_total", "atelier")]).toBe(50848);
  });

  it("bloc Marge APV : libellés courts résolus dans leur bloc", () => {
    expect(v["marge_mo"]).toBe(12000);
    expect(v["marge_st"]).toBe(500);
    expect(v["marge_autres"]).toBe(300);
    expect(v["marge_total_mo"]).toBe(12800);
    expect(v["marge_pr"]).toBe(1800);
    expect(v["marge_pneus"]).toBe(150);
    expect(v["marge_huiles"]).toBe(400);
    expect(v["marge_total_pr"]).toBe(2350);
    expect(v["gain_apv"]).toBe(15150);
    expect(v["resultat"]).toBe(4200);
  });

  it("ne confond pas Pneus 5% de la marge avec la ligne CA Pneumatiques", () => {
    expect(v["pneumatiques"]).toBe(3000);
    expect(v["marge_pneus"]).toBe(150);
  });

  it("productifs, heures et entrées", () => {
    expect(v["nb_productifs"]).toBe(6);
    expect(v["heures_achetees"]).toBe(900);
    expect(v["heures_passees"]).toBe(850);
    expect(v["heures_facturees"]).toBe(800);
    expect(v["realisation"]).toBeCloseTo(0.94);
    expect(v["entrees_payantes"]).toBe(210);
    expect(v["entrees_toutes"]).toBe(260);
  });

  it("charges, fournitures, charges fixes et VO", () => {
    expect(v["ch_loyer_batiment"]).toBe(3000);
    expect(v["ch_assurance"]).toBe(0);
    expect(v["ch_honoraires"]).toBeNull();
    expect(v["fo_elec"]).toBe(800);
    expect(v["fx_salaires"]).toBe(25000);
    expect(v["fx_charges"]).toBe(9000);
    expect(v["vo_marge_brute"]).toBe(4000);
  });

  it("distingue données manquantes et rubriques non reconnues", () => {
    const missing = anomalies.filter((a) => a.kind === "missing");
    const unknown = anomalies.filter((a) => a.kind === "unknown");
    expect(missing.map((a) => a.label)).toContain("Honoraires");
    expect(unknown).toHaveLength(1);
    expect(unknown[0]?.message).toContain("DDA / Lalinde → DDA0826 → Ligne maison non prévue");
    // les titres de blocs et entêtes ne sont jamais des anomalies
    expect(anomalies.some((a) => a.label === "Marge APV" || a.label === "Heures")).toBe(false);
  });

  it("CASTI0826 : même structure, société Castillon", () => {
    const parsed = parseWorkbookSheets([{ name: "CASTI0826", rows: casti0826 }]);
    expect(parsed.site).toBe("castillon");
    const cv = parsed.months[0]?.values ?? {};
    expect(cv["ca_total"]).toBe(26000);
    expect(cv[apvSubKey("ca_mo", "cession")]).toBe(100);
    expect(cv["heures_facturees"]).toBe(460);
  });
});

describe("exercice comptable avril → mars", () => {
  it("un mois d'août appartient à l'exercice ouvert le 1er avril", () => {
    expect(fiscalYearRange("2026-08-01")).toEqual({ start: "2026-04-01", end: "2027-03-01" });
  });
  it("un mois de janvier appartient à l'exercice de l'année précédente", () => {
    expect(fiscalYearRange("2027-01-01")).toEqual({ start: "2026-04-01", end: "2027-03-01" });
    expect(fiscalYearRange("2026-03-01").start).toBe("2025-04-01");
  });
  it("libellé au format 04/2026 → 03/2027", () => {
    expect(fiscalYearLabel("2026-08-01")).toBe("Exercice 04/2026 → 03/2027");
    expect(currentFiscalYear(new Date(2026, 7, 15)).label).toBe("Exercice 04/2026 → 03/2027");
  });
});

describe("import atomique", () => {
  beforeEach(() => {
    rpc.mockReset();
    from.mockReset();
  });

  it("écrit tout via une seule transaction base", async () => {
    rpc.mockResolvedValue({ data: "import-1", error: null });
    const { saveWorkbook } = await import("@/lib/activity/store");
    const parsed = parseWorkbookSheets([{ name: "DDA0826", rows: dda0826 }]);
    const id = await saveWorkbook(parsed, { fileName: "dda.xlsx", userId: "u1", userName: "Damien" });
    expect(id).toBe("import-1");
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc.mock.calls[0]?.[0]).toBe("activity_import_apply");
    expect(from).not.toHaveBeenCalled();
  });

  it("en cas d'échec, aucune écriture partielle n'est tentée", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "rollback" } });
    const { saveWorkbook } = await import("@/lib/activity/store");
    const parsed = parseWorkbookSheets([{ name: "DDA0826", rows: dda0826 }]);
    await expect(saveWorkbook(parsed, { fileName: null, userId: null, userName: null })).rejects.toBeTruthy();
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(from).not.toHaveBeenCalled();
  });
});
