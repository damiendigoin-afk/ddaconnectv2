import { describe, expect, it } from "vitest";
import { detectKind, parseExport, resolveColumns } from "@/lib/winmotor/invoices";

const DH = ["Numéro du client", "Civilité", "Nom et Prénom", "Code Postal", "Ville", "Numéro du client facturé", "Client facturé", "Immatriculation", "VIN", "Marque", "Gamme", "Date de mise en circulation", "Date de facturation", "Date d'ouverture de l'OR", "Activité", "Numéro de facture", "Numéro de dossier", "Type de ligne", "Code ventilation", "Référence", "Libellé", "Code Constructeur", "Code famille", "Prix de vente unitaire brut", "Prix de vente unitaire net", "Quantité", "Prix de vente net", "Code TVA"];
const row = ["000692", "M", "MARTIN PAUL", "24220", "ST CYPRIEN", "000900", "ASSUR SA", "CK862WH", "VF1JZ000D47785757", "Renault", "SCENIC III", "2012/09/18", "2026/09/02", "2026/09/01", "001", "606695", "10084", "Pièce", "V1", "8660003780", "Filtre huile", "RN", "FILT", "20,00", "15,00", "2", "30,00", "2"];

describe("export Détail WinMotor réel (28 colonnes)", () => {
  const r = parseExport([DH.join(";"), row.join(";")].join("\r\n"), null);
  const col = (k: string) => DH[r.map[k]!];
  it("détection + aucun obligatoire manquant", () => {
    expect(detectKind(DH)).toBe("details");
    expect(r.kind).toBe("details");
    expect(r.missing).toEqual([]);
  });
  it("mappings exacts", () => {
    expect(col("date")).toBe("Date de facturation");
    expect(col("or")).toBe("Numéro de dossier");
    expect(col("client_no")).toBe("Numéro du client");
    expect(col("client_name")).toBe("Nom et Prénom");
    expect(col("billed_no")).toBe("Numéro du client facturé");
    expect(col("billed_name")).toBe("Client facturé");
    expect(col("unit")).toBe("Prix de vente unitaire net");
    expect(col("net")).toBe("Prix de vente net");
    expect(col("qty")).toBe("Quantité");
    expect(col("vat_code")).toBe("Code TVA");
    expect(col("family")).toBe("Code famille");
    expect(col("mec")).toBe("Date de mise en circulation");
  });
  it("valeurs lues", () => {
    const inv = r.invoices[0]!;
    expect(inv.date).toBe("2026-09-02");
    expect(inv.or).toBe("10084");
    expect(inv.billed_no).toBe("000900");
    expect(inv.billed_name).toBe("ASSUR SA");
    expect(inv.client_name).toBe("MARTIN PAUL");
    const l = inv.lines[0]!;
    expect([l.unit, l.qty, l.net, l.vat_code, l.vat_rate]).toEqual([15, 2, 30, "2", 20]);
    expect(l.extra?.["Prix de vente unitaire brut"]).toBe("20,00");
    expect(r.dateMin).toBe("2026-09-02");
  });
});

describe("export Entêtes WinMotor réel", () => {
  const H = ["Numéro de client", "Civilité", "Nom et Prénom", "Type du client", "Adresse 1", "Numéro de facture", "Numéro de dossier", "Adresse 2", "Code Postal", "Ville", "Téléphone", "Mobile", "Adresse E-mail", "Nom du client facturé", "Immatriculation du véhicule", "VIN", "Date de dernière visite", "Date de facturation", "Marque", "Gamme", "Modèle", "Code National (Type Mine)", "Dernier km au compteur", "Date de début de garantie", "Total HT", "Total TVA", "Total TTC", "Vendeur", "Activité", "Date de première mise en ciruclation", "Code OPB/OC", "T.V.V"];
  it("colonnes clés", () => {
    const { map, missing } = resolveColumns(H, "headers");
    expect(missing).toEqual([]);
    const c = (k: string) => H[map[k]!];
    expect(c("date")).toBe("Date de facturation");
    expect(c("client_name")).toBe("Nom et Prénom");
    expect(map["client_first"]).toBeUndefined();
    expect(c("billed_name")).toBe("Nom du client facturé");
    expect(map["billed_no"]).toBeUndefined();
    expect(c("plate")).toBe("Immatriculation du véhicule");
    expect(c("mec")).toBe("Date de première mise en ciruclation");
    expect(c("email")).toBe("Adresse E-mail");
    expect(c("address")).toBe("Adresse 1");
    expect(c("total_tva")).toBe("Total TVA");
  });
  it("date AAAA/MM/JJ lue", () => {
    const vals = H.map((h) => (h === "Numéro de facture" ? "606695" : h === "Date de facturation" ? "2018/01/03" : h === "Total TTC" ? "206.63" : ""));
    const r = parseExport([H.join(";"), vals.join(";")].join("\n"), "headers");
    expect(r.dateMin).toBe("2018-01-03");
    expect(r.headerRows[0]!.date).toBe("2018-01-03");
  });
});
