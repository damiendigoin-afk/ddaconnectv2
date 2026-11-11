import { describe, expect, it } from "vitest";
import { reconcileCandidates } from "../ixellio-parts-reconcile";

const part = (d: string, a: number) => ({ designations: [{ value: d }], prices: [{ amount: a }] });
const results = [{ designation: "GUIDAGE AIR ARMATURE AV", amount: 26.44 }, { designation: "CONVERGENT G", amount: 26.44 }];
const parts = results.map((r) => part(r.designation, r.amount));
const cands = [{ label: "GUIDAGE AIR ARMATURE AV", amount: 26.44 }, { label: "CONVERGENT G", amount: 26.44 }];

describe("réconciliation E ↔ F (affichage seul)", () => {
  it("ok 2/2 : tous les candidats couverts par F", () => {
    expect(reconcileCandidates("ok", parts, results, cands)).toEqual({ covered: [true, true], allCovered: true });
  });
  it("statut non ok : avertissements conservés", () => {
    expect(reconcileCandidates("structure_non_reconnue", parts, results, cands).allCovered).toBe(false);
  });
  it("montant différent ou candidat en plus : pas de couverture abusive", () => {
    const r = reconcileCandidates("ok", parts, results, [...cands, { label: "AUTRE", amount: 26.44 }, { label: "CONVERGENT G", amount: 30 }]);
    expect(r).toEqual({ covered: [true, true, false, false], allCovered: false });
  });
  it("parts et groupement incohérents : rien de couvert", () => {
    expect(reconcileCandidates("ok", [parts[0]!], results, cands).allCovered).toBe(false);
    expect(reconcileCandidates("ok", [parts[0]!, part("X", 26.44)], results, cands).covered).toEqual([false, false]);
  });
});
