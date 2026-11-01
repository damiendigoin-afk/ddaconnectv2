import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/** Contrat d'autorisation de la migration V10 PRÉPARÉE (non appliquée) : lecture statique du SQL. */
const sql = readFileSync("docs/migrations-pending/V10_tyres_commercial_traffic.sql", "utf8")
  .split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");
const norm = sql.replace(/\s+/g, " ");

describe("Migration V10 — droits tyre_commercial_requests", () => {
  it("authenticated n'a que SELECT (aucun UPDATE/INSERT/DELETE, même par colonnes)", () => {
    const grants = [...norm.matchAll(/GRANT ([^;]+?) ON (?:TABLE )?public\.tyre_commercial_requests TO ([^;]+);/gi)];
    const toAuth = grants.filter((g) => /authenticated|anon/i.test(g[2]!));
    expect(toAuth.map((g) => g[1]!.trim().toUpperCase())).toEqual(["SELECT"]);
    expect(norm).toMatch(/GRANT ALL ON public\.tyre_commercial_requests TO service_role;/);
    expect(norm).toMatch(/REVOKE INSERT, UPDATE, DELETE ON public\.tyre_commercial_requests FROM authenticated, anon;/);
  });

  it("aucune politique UPDATE/INSERT/DELETE ; lecture limitée manager + site", () => {
    const pols = [...norm.matchAll(/CREATE POLICY "[^"]+" ON public\.tyre_commercial_requests FOR (\w+)/gi)].map((m) => m[1]!.toUpperCase());
    expect(pols).toEqual(["SELECT"]);
    expect(norm).toMatch(/has_role\(auth\.uid\(\), 'manager'\) AND public\.user_can_access_site\(auth\.uid\(\), site_id\)/);
  });

  it("RPC statut : SECURITY DEFINER, search_path fixé, manager+site, liste blanche, ne modifie que le statut", () => {
    const fn = norm.slice(norm.indexOf("FUNCTION public.set_tyre_prospect_status"), norm.indexOf("END $$;"));
    expect(fn).toMatch(/SECURITY DEFINER SET search_path = public/);
    expect(fn).toMatch(/has_role\(auth\.uid\(\), 'manager'\) AND user_can_access_site\(auth\.uid\(\), _site\)/);
    expect(fn).toMatch(/_status NOT IN \('nouveau','a_contacter','contacte','rdv_pris','vendu','perdu'\)/);
    const set = /UPDATE tyre_commercial_requests SET (.+?) WHERE/.exec(fn)![1]!;
    const cols = set.split(",").map((c) => c.trim().split(" ")[0]);
    expect(cols).toEqual(["prospect_status", "status_changed_at", "status_changed_by"]);
    expect(norm).toMatch(/REVOKE ALL ON FUNCTION public\.set_tyre_prospect_status\(uuid, text\) FROM PUBLIC, anon;/);
  });
});
