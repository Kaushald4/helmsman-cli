import { describe, it, expect } from "vitest";
import { jaccardSimilarity } from "../src/healing/resolvers/accessibility.js";
import { DomResolver } from "../src/healing/resolvers/dom.js";

describe("Self-Healing Heuristics", () => {
  it("should calculate Jaccard token similarity accurately", () => {
    const setA = new Set(["submit", "order"]);
    const setB = new Set(["submit", "order", "now"]);
    const score = jaccardSimilarity(setA, setB);
    // 2 in common / 3 total union = 0.666...
    expect(score).toBeCloseTo(0.67, 1);

    const setC = new Set(["cancel", "payment"]);
    expect(jaccardSimilarity(setA, setC)).toBe(0);
  });

  it("should return null on empty token sets", () => {
    expect(jaccardSimilarity(new Set(), new Set())).toBe(0);
  });

  it("should initialize DomResolver at tier dom", () => {
    const resolver = new DomResolver();
    expect(resolver.tier).toBe("dom");
  });
});
