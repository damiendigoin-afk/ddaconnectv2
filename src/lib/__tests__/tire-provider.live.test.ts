import { expect, test } from "vitest";
import { extractItems, providerUrlFor, fetchPublicTires } from "@/lib/tire-provider.server";
test("url", () => expect(providerUrlFor("215/65R16")).toContain("pneu-auto-215-65-16"));
test("live", async () => {
  const r = await fetchPublicTires("215/65R16");
  console.log(r.ok ? r.items.slice(0,3) : r);
  expect(r.ok).toBe(true);
}, 30000);
