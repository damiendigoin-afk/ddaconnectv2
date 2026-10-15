import { describe, expect, it } from "vitest";

import {
  buildCaseFormPrefill,
  compareWithRef,
  docCategory,
  looksLikeRepairOrder,
  mapRepairOrderExtract,
  stripGeneralConditions,
} from "../bodyshop-doc";

// Fixture synthétique reproduisant la structure du PDF WinMotor OR 17264 (Lalinde, 15/10/2026).
const OR_TEXT = `SAS DAMIEN DIGOIN AUTOMOBILE AGENT RENAULT
ZA LALINDE 24150 LALINDE Tél. 05 53 61 00 00 contact@digoin-automobile.fr SIRET 000
Ordre de Réparation n° 17264 du 15/10/2026
Votre conseiller : JEAN Tél. 05 53 61 00 01
Immat. Marque Modèle N° compte
HF-023-QC DS DS3 CROSSBACK 1.2 PU 402515
VIN VR1URHPY4SW040557
Mme VERNET ISABELLE
3 RUE PORTE CAMPAN
24540 MONTPAZIER
Portable 0689351021 isabelle.vernet24@wanadoo.fr
Remarques du client
REPARATIONS SUIVANT EXPERTISE
CHOC PAVILLON
ESSAI ROUTIER
Travaux à effectuer
Renault care service - longue vie aux voitures à vivre
${"x ".repeat(150)}
CONDITIONS GÉNÉRALES DE RÉPARATION
Article 1 : le client Mme DUPONT 0612345678 ... HAIL GRELE ASSURANCE MAIF sinistre 999`;

// Sortie du moteur OR atelier (après sanitizeRepairOrder), y compris pièges.
const OR_PARSED = {
  client: {
    account_number: "402515",
    last_name: "VERNET",
    first_name: "ISABELLE",
    address: "3 RUE PORTE CAMPAN",
    postal_code: "24540",
    city: "MONTPAZIER",
    phone: "05 53 61 00 00", // téléphone du garage : doit être filtré
    mobile: "0689351021",
    email: "isabelle.vernet24@wanadoo.fr",
  },
  vehicle: { plate: "HF023QC", vin: "VR1URHPY4SW040557", brand: "RENAULT", model: "DS3 CROSSBACK 1.2 PU" },
  order: {
    or_number: "17264",
    or_date: "2026-10-15",
    client_remarks: "REPARATIONS SUIVANT EXPERTISE\nCHOC PAVILLON\nESSAI ROUTIER",
    requested_work: null,
  },
  uncertain: [],
};

describe("1) OR PDF texte 17264 -> moteur OR atelier", () => {
  it("est détecté comme ordre de réparation par le contenu et le nom de fichier", () => {
    expect(looksLikeRepairOrder(OR_TEXT, "Impression du dossier Ordre de Réparation n° 17264 - 20261015135752.pdf")).toBe(true);
    expect(looksLikeRepairOrder(OR_TEXT, "scan.pdf")).toBe(true);
  });
  it("mappe client, véhicule, OR et commentaires", () => {
    const e = mapRepairOrderExtract(OR_PARSED, OR_TEXT);
    expect(e.engine).toBe("repair_order");
    expect(e.or_number).toBe("17264");
    expect(e.plate).toBe("HF-023-QC");
    expect(e.vin).toBe("VR1URHPY4SW040557");
    expect(e.customer_name).toBe("Mme VERNET ISABELLE");
    expect(e.customer_account).toBe("402515");
    expect(e.customer_phone).toBe("0689351021");
    expect(e.customer_email).toBe("isabelle.vernet24@wanadoo.fr");
    expect(e.customer_address).toBe("3 RUE PORTE CAMPAN, 24540 MONTPAZIER");
    expect(e.vehicle_label).toBe("DS3 CROSSBACK 1.2 PU");
    expect(e.vehicle_label).not.toMatch(/renault/i);
    expect(e.comments).toBe("Remarques du client :\nREPARATIONS SUIVANT EXPERTISE\nCHOC PAVILLON\nESSAI ROUTIER");
  });
  it("ignore les conditions générales", () => {
    const t = stripGeneralConditions(OR_TEXT);
    expect(t).not.toMatch(/DUPONT|MAIF|GRELE/);
    expect(t).toMatch(/VERNET/);
  });
});

describe("2) photo / scan OR", () => {
  it("détecte un OR photographié au texte bruité sans titre lisible", () => {
    const ocr = "Remarques du dlient\nREPARATIONS SUIVANT\nTravaux a effectuer\nN° compte 402515\nVotre conseiller";
    expect(looksLikeRepairOrder(ocr, "IMG_20261015.jpg")).toBe(true);
  });
  it("une valeur douteuse reste vide et signalée", () => {
    const e = mapRepairOrderExtract({ ...OR_PARSED, vehicle: { ...OR_PARSED.vehicle, plate: "HF02?QC", vin: "VR1URHPY4SW04055" } }, OR_TEXT);
    expect(e.plate).toBeNull();
    expect(e.vin).toBeNull();
    expect(e.uncertain).toEqual(expect.arrayContaining(["vehicle.plate", "vehicle.vin"]));
  });
});

describe("3) document non OR -> moteur générique", () => {
  it("avis de sinistre / carte grise ne sont pas aiguillés vers le moteur OR", () => {
    expect(looksLikeRepairOrder("AVIS DE SINISTRE n° 12345 Assureur MAIF Expert CABINET X", "sinistre.pdf")).toBe(false);
    expect(looksLikeRepairOrder("CERTIFICAT D'IMMATRICULATION A HF-023-QC E VR1URHPY4SW040557", "carte grise.jpg")).toBe(false);
    expect(looksLikeRepairOrder("Ordre de réparation", "rapport expertise.pdf")).toBe(false);
  });
});

describe("4) conflits base / document", () => {
  const ref = { plate: "HF-023-QC", vin: "VF1AAAAAAAAAAAAAA", last_name: "VERNET", first_name: "ISABELLE", mobile: "0600000000", email: "" };
  it("divergence VIN : signalée, valeur document conservée, pas de liaison automatique", () => {
    const e = mapRepairOrderExtract(OR_PARSED, OR_TEXT);
    const f = buildCaseFormPrefill(e, ref);
    expect(f.vin).toBe("VR1URHPY4SW040557");
    expect(f.conflicts.map((c) => c.field)).toEqual(expect.arrayContaining(["vin", "customer_phone"]));
    expect(f.linkRef).toBe(false);
  });
  it("concordance : liaison à la fiche existante (pas de doublon), base complète les vides", () => {
    const e = { ...mapRepairOrderExtract(OR_PARSED, OR_TEXT), customer_email: null };
    const f = buildCaseFormPrefill(e, { ...ref, vin: "VR1URHPY4SW040557", mobile: "0689351021", email: "iv@exemple.fr" });
    expect(compareWithRef(e, { ...ref, vin: "VR1URHPY4SW040557", mobile: "0689351021" })).toEqual([]);
    expect(f.linkRef).toBe(true);
    expect(f.customerEmail).toBe("iv@exemple.fr");
    expect(f.fromBase).toEqual(["E-mail"]);
  });
});

describe("5) absence assurance / grêle / VGE", () => {
  it("aucune donnée assurance ou sinistre inventée", () => {
    const e = mapRepairOrderExtract(OR_PARSED, OR_TEXT);
    expect(e.insurer).toBeNull();
    expect(e.claim_number).toBeNull();
    const f = buildCaseFormPrefill(e, null);
    expect(f.claim).toBe("");
    expect(Object.keys(f)).not.toEqual(expect.arrayContaining(["isHail", "isVge", "payer", "origin"]));
  });
});

describe("6) coordonnées garage filtrées", () => {
  it("téléphone et e-mail garage jamais repris pour le client", () => {
    const e = mapRepairOrderExtract(
      { ...OR_PARSED, client: { ...OR_PARSED.client, mobile: null, phone: "0553610000", email: "contact@digoin-automobile.fr" } },
      OR_TEXT,
    );
    expect(e.customer_phone).toBeNull();
    expect(e.customer_email).toBeNull();
  });
  it("slogan et conseiller exclus des commentaires", () => {
    const e = mapRepairOrderExtract(
      { ...OR_PARSED, order: { ...OR_PARSED.order, requested_work: "Renault care service\nVotre conseiller JEAN" } },
      OR_TEXT,
    );
    expect(e.comments).not.toMatch(/care service|conseiller/i);
  });
});

describe("7) formulaire et pièce jointe", () => {
  it("préremplissage complet et pièce jointe rangée en OR", () => {
    const f = buildCaseFormPrefill(mapRepairOrderExtract(OR_PARSED, OR_TEXT), null);
    expect(f).toMatchObject({
      plate: "HF-023-QC",
      orNumber: "17264",
      customerName: "Mme VERNET ISABELLE",
      customerPhone: "0689351021",
      vehicleLabel: "DS3 CROSSBACK 1.2 PU",
      docCategory: "or",
    });
    expect(docCategory("avis_sinistre")).toBe("sinistre");
    expect(docCategory(undefined)).toBe("autres");
  });
});
