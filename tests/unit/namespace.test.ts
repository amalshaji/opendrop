import { describe, expect, it } from "vitest";
import { namespaceCandidateForEmail, normalizeNamespace, validateNamespace } from "@opendrop/shared/core";

describe("namespace generation", () => {
  it("uses the email local part", () => {
    expect(namespaceCandidateForEmail("Amal.Shaji@example.com")).toBe("amal-shaji");
  });

  it("blocks reserved names", () => {
    expect(validateNamespace("api")).toBeTruthy();
  });

  it("normalizes unsafe characters", () => {
    expect(normalizeNamespace("A B___C!!")).toBe("a-b-c");
  });
});
