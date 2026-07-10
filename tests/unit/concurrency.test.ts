import { describe, expect, it } from "vitest";
import { mapWithConcurrency } from "../../packages/shared/src/core";

describe("mapWithConcurrency", () => {
  it("preserves order, limits active work, and reports progress", async () => {
    let active = 0;
    let maxActive = 0;
    const progress: number[] = [];
    const result = await mapWithConcurrency([4, 3, 2, 1], 2, async (value) => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => setTimeout(resolve, value));
      active -= 1;
      return value * 2;
    }, (completed) => progress.push(completed));
    expect(result).toEqual([8, 6, 4, 2]);
    expect(maxActive).toBe(2);
    expect(progress).toEqual([1, 2, 3, 4]);
  });
});
