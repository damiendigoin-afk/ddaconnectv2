import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { planFillEmpty } from "@/lib/ixellio-map";
import { parseIxellioHtml } from "@/lib/ixellio-parse";
import { extractCsrf } from "@/lib/ixellio.server";
import { buildRefVehiclePatch, initialEditForm } from "@/lib/ref-vehicle-edit";

/** Structure réelle observée le 27/09/2026 (valeurs anonymisées). */
const MENU = `<form id="ident_admin_search_immat" method="post" action="/ident.html?method=" onsubmit="if(!searchLocalBase(this, 'FR',false))return false;"><input type="hidden" name="_csrf" value="TOKEN-IMMAT"/><div id="plaque-recherche"><input name="immat" value="" maxlength="15"></div></form>
<form id="ident_admin_search" method="post" action="/ident.html?method=searchByAdminId"><input type="hidden" name="_csrf" value="TOKEN-OTHER"/></form>`;

const RESULT = `<table><tr class="oddAAA"><td style="font-weight: bold;">Marque</td><td>RENAULT</td><td style="font-weight: bold;">Modèle</td><td>CAPTUR</td></tr>
<tr class="evenAAA"><td style="font-weight: bold;">Date de 1ère mise en circulation</td><td>01/02/2020</td><td style="font-weight: bold;">Poids à vide</td><td>1200</td></tr>
<tr class="oddAAA"><td style="font-weight: bold;">Code moteur</td><td>X9X A1</td><td style="font-weight: bold;">Masse en service</td><td>1800</td></tr>
<tr class="evenAAA"><td style="font-weight: bold;">Nombre de portes</td><td>5</td><td style="font-weight: bold;">Couleur</td><td>BLANC</td></tr></table>`;

describe("IXELLIO : structure réelle", () => {
  it("récupère le jeton _csrf du formulaire immat (absent → HTTP 403 Accès refusé)", () => {
    expect(extractCsrf(MENU)).toBe("TOKEN-IMMAT");
    expect(extractCsrf("<html></html>")).toBeNull();
  });
  it("le POST de recherche envoie _csrf", () => {
    const src = readFileSync("src/lib/ixellio.server.ts", "utf8");
    expect(src).toContain('searchBody.set("_csrf", csrf)');
    expect(src).toContain("body: searchBody.toString()");
  });
  it("parse la page résultat (tableau td gras / valeur)", () => {
    const r = parseIxellioHtml(RESULT);
    expect(r.vehicle.marque).toBe("RENAULT");
    expect(r.vehicle.codeMoteur).toBe("X9X A1");
    expect(r.vehicle.dateMec).toBe("01/02/2020");
    expect(r.fieldCount).toBeGreaterThanOrEqual(4);
    const plan = planFillEmpty({ brand: "DACIA", engine_code: null }, r.vehicle);
    expect(plan.patch.engine_code).toBe("X9X A1");
    expect(plan.patch.brand).toBeUndefined();
  });
});

describe("édition directe fiche véhicule", () => {
  it("aucune modification → patch vide ; une modification → seul ce champ", () => {
    const v = { vin: "VF1", color: "GRIS", first_registration_date: "2020-02-01T00:00:00" };
    const form = initialEditForm(v);
    expect(buildRefVehiclePatch(v, form)).toEqual({});
    expect(buildRefVehiclePatch(v, { ...form, color: "BLEU" })).toEqual({ color: "BLEU" });
  });
  it("plus de modale, aucune écriture legacy", () => {
    const ed = readFileSync("src/components/VehicleInlineEditor.tsx", "utf8");
    const ix = readFileSync("src/components/RefVehicleActions.tsx", "utf8");
    for (const s of [ed, ix]) {
      expect(s).not.toMatch(/from\("vehicles"\)|InfoEditForm|Dialog/);
    }
  });
});
