import { describe, expect, it } from "vitest";

import { detectVersionList, parseIxellioHtml } from "../ixellio-parse";

/** Fiche véhicule type IXELLIO (tableau libellé/valeur), données fictives. */
const FICHE_TABLE = `
<html><body>
<h1>Information carte grise</h1>
<table class="fiche">
  <tr><td class="lib">Marque</td><td class="val">RENAULT</td><td class="lib">Mod&egrave;le</td><td class="val">CLIO IV</td></tr>
  <tr><td class="lib">Version</td><td class="val">1.5 DCI 90 BUSINESS</td><td class="lib">VIN</td><td class="val">VF1RFB00X12345678</td></tr>
  <tr><td class="lib">CNIT</td><td class="val">M10RENVP0123456</td><td class="lib">Type Mine</td><td class="val">MRE1234</td></tr>
  <tr><td class="lib">TVV</td><td class="val">BH0G</td><td class="lib">Code moteur</td><td class="val">K9K628</td></tr>
  <tr><td class="lib">Cylindr&eacute;e</td><td class="val">1461 cm3</td><td class="lib">Carburant</td><td class="val">GAZOLE</td></tr>
  <tr><td class="lib">Bo&icirc;te de vitesses</td><td class="val">MANUELLE 5</td><td class="lib">Code bo&icirc;te</td><td class="val">JR5</td></tr>
  <tr><td class="lib">Date de 1re mise en circulation</td><td class="val">14/06/2016</td><td class="lib">Couleur</td><td class="val">GRIS TITANIUM</td></tr>
  <tr><td class="lib">Puissance fiscale</td><td class="val">5 CV</td><td class="lib">Puissance ch</td><td class="val">90</td></tr>
  <tr><td class="lib">Puissance kW</td><td class="val">66</td><td class="lib">CO2</td><td class="val">95 g/km</td></tr>
  <tr><td class="lib">Nombre de portes</td><td class="val">5</td><td class="lib">Nombre de places</td><td class="val">5</td></tr>
  <tr><td class="lib">Carrosserie</td><td class="val">BREAK</td><td class="lib">Genre</td><td class="val">VP</td></tr>
  <tr><td class="lib">PTAC</td><td class="val">1 690 kg</td><td class="lib">Masse &agrave; vide</td><td class="val">1 150 kg</td></tr>
</table>
</body></html>`;

/** Variante « blocs libellé/valeur » (spans) + champs readonly. */
const FICHE_BLOCS = `
<div class="bloc"><span class="libelle">Marque</span><span class="valeur">PEUGEOT</span></div>
<div class="bloc"><span class="libelle">Modele</span><span class="valeur">308</span></div>
<dl><dt>Code moteur</dt><dd>EB2DTS</dd><dt>Carburant</dt><dd>ESSENCE</dd></dl>
<label for="vin">VIN</label><input id="vin" readonly value="VF3LBHZTXHS123456" />
<label for="cv">Puissance fiscale</label><input id="cv" readonly value="7" />
`;

/** Page intermédiaire de choix de version. */
const LISTE_VERSIONS = `
<p>Plusieurs versions correspondent, veuillez choisir la version :</p>
<table>
  <tr><td>1.6 THP 165</td><td><a href="/ident.html?method=select&idx=1">Choisir</a></td></tr>
  <tr><td>1.6 THP 205</td><td><a href="/ident.html?method=select&idx=2">Choisir</a></td></tr>
  <tr><td>2.0 BlueHDi 180</td><td><a href="/ident.html?method=select&idx=3">Choisir</a></td></tr>
</table>`;

describe("parseIxellioHtml", () => {
  it("extrait les champs d'une fiche tabulaire", () => {
    const r = parseIxellioHtml(FICHE_TABLE);
    expect(r.vehicle).toMatchObject({
      marque: "RENAULT",
      modele: "CLIO IV",
      version: "1.5 DCI 90 BUSINESS",
      vin: "VF1RFB00X12345678",
      cnit: "M10RENVP0123456",
      typeMine: "MRE1234",
      tvv: "BH0G",
      codeMoteur: "K9K628",
      cylindree: "1461 cm3",
      carburant: "GAZOLE",
      boite: "MANUELLE 5",
      codeBoite: "JR5",
      dateMec: "14/06/2016",
      couleur: "GRIS TITANIUM",
      puissanceFiscale: "5 CV",
      puissanceCh: "90",
      puissanceKw: "66",
      co2: "95 g/km",
      portes: "5",
      places: "5",
      carrosserie: "BREAK",
      genre: "VP",
      ptac: "1 690 kg",
      masseVide: "1 150 kg",
    });
    expect(r.fieldCount).toBeGreaterThanOrEqual(20);
    expect(r.detectedFields).toContain("marque");
    expect(r.isVersionList).toBe(false);
  });

  it("ne confond jamais puissance fiscale et kW", () => {
    const v = parseIxellioHtml(FICHE_TABLE).vehicle;
    expect(v.puissanceFiscale).toBe("5 CV");
    expect(v.puissanceKw).toBe("66");
  });

  it("extrait les champs des blocs libellé/valeur et des inputs", () => {
    const r = parseIxellioHtml(FICHE_BLOCS);
    expect(r.vehicle.marque).toBe("PEUGEOT");
    expect(r.vehicle.modele).toBe("308");
    expect(r.vehicle.codeMoteur).toBe("EB2DTS");
    expect(r.vehicle.carburant).toBe("ESSENCE");
    expect(r.vehicle.vin).toBe("VF3LBHZTXHS123456");
    expect(r.vehicle.puissanceFiscale).toBe("7");
  });

  it("garde le VIN en fallback quand la structure est inconnue", () => {
    const r = parseIxellioHtml("<div>blabla VF7XXXXXXXX123456 blabla</div>");
    expect(r.vehicle.vin).toBe("VF7XXXXXXXX123456");
    expect(r.fieldCount).toBe(1);
  });

  it("détecte une page de choix de version", () => {
    expect(detectVersionList(LISTE_VERSIONS)).toEqual({ isVersionList: true, versionCount: 3 });
    expect(parseIxellioHtml(LISTE_VERSIONS).isVersionList).toBe(true);
  });
});
