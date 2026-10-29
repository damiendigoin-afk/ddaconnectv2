import { describe, expect, it } from "vitest";
import { CT_MISSING, ctPersistValues, ctPointLine, reportCtDates, stripCtAuto } from "@/lib/ct";

const ctPoint = (ct: string | null, status = "ok") => ({ point_key: "controle_technique", status, ct_due_date: ct, pollution_due_date: null });

describe("date CT dans les rapports", () => {
  it("CT OK avec date sur le point : la date est affichée", () => {
    const d = reportCtDates({ vehicle: { ct_due_date: "2027-01-01" }, points: [ctPoint("2027-04-15")] });
    expect(d.ct).toBe("2027-04-15");
    expect(ctPointLine(d.ct, d.pollution)).toBe("CT valable jusqu'au 15/04/2027");
  });

  it("point null : la date de la fiche véhicule est reprise", () => {
    expect(reportCtDates({ vehicle: { ct_due_date: "2027-03-02" }, points: [ctPoint(null)] }).ct).toBe("2027-03-02");
  });

  it("point vide ou invalide : la date véhicule n'est pas perdue", () => {
    expect(reportCtDates({ vehicle: { ct_due_date: "2027-03-02" }, points: [ctPoint("")] }).ct).toBe("2027-03-02");
    expect(reportCtDates({ vehicle: { ct_due_date: "2027-03-02" }, points: [ctPoint("  ")] }).ct).toBe("2027-03-02");
  });

  it("aucune date : mention non renseignée, rien d'inventé", () => {
    const d = reportCtDates({ vehicle: { ct_due_date: null }, points: [ctPoint(null)] });
    expect(d.ct).toBeNull();
    expect(ctPointLine(d.ct, null)).toBe(CT_MISSING);
  });

  it("lecture OCR vide : aucun champ effacé", () => {
    expect(ctPersistValues("", "", false)).toEqual({});
  });

  it("saisie manuelle : date enregistrée, effacement explicite possible", () => {
    expect(ctPersistValues("2027-04-15", "", true)).toEqual({ ct_due_date: "2027-04-15", pollution_due_date: null });
    expect(ctPersistValues("", "", true)).toEqual({ ct_due_date: null, pollution_due_date: null });
  });

  it("commentaire : ligne CT automatique retirée, texte opérateur gardé", () => {
    expect(stripCtAuto("Vignette abîmée\nDate du contrôle technique non renseignée.")).toBe("Vignette abîmée");
  });
});
