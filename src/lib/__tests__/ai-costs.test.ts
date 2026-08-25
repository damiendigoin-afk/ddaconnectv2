import { describe, expect, it } from "vitest";

import { alertLevel, summarize, type AiUsageRow } from "../ai-costs";

const row = (o: Partial<AiUsageRow>): AiUsageRow => ({
  id: Math.random().toString(36),
  created_at: new Date().toISOString(),
  feature: "ocr_compteur",
  model: "google/gemini-3.5-flash",
  entity: null,
  tokens_in: 1000,
  tokens_out: 50,
  duration_ms: 900,
  http_status: 200,
  success: true,
  cache_hit: false,
  blocked_reason: null,
  estimated_credits: 0.03,
  ...o,
});

describe("summarize", () => {
  it("distingue appels payants, cache, blocages et échecs facturés", () => {
    const s = summarize([
      row({}),
      row({ cache_hit: true, estimated_credits: 0 }),
      row({ success: false, blocked_reason: "budget_journalier", estimated_credits: 0 }),
      row({ success: false, http_status: 499, estimated_credits: 1.4, feature: "memento_fallback" }),
    ]);
    expect(s.callsToday).toBe(3);
    expect(s.cacheHitsToday).toBe(1);
    expect(s.blockedToday).toBe(1);
    expect(s.failedBilledToday).toBe(1);
    expect(Math.round(s.today * 100) / 100).toBe(1.43);
    expect(s.byFeature[0]!.feature).toBe("memento_fallback");
  });
});

describe("alertLevel", () => {
  it("renvoie les paliers 50 / 75 / 90 / 100", () => {
    expect(alertLevel(1, 10)).toBe(0);
    expect(alertLevel(5, 10)).toBe(50);
    expect(alertLevel(7.6, 10)).toBe(75);
    expect(alertLevel(9.2, 10)).toBe(90);
    expect(alertLevel(11, 10)).toBe(100);
  });
});
