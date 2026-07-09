import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const skillsDir = "skills";

describe("repo-hosted skills", () => {
  for (const name of readdirSync(skillsDir).filter((entry) => statSync(join(skillsDir, entry)).isDirectory())) {
    it(`${name} has required files`, () => {
      const skill = readFileSync(join(skillsDir, name, "SKILL.md"), "utf8");
      const openai = readFileSync(join(skillsDir, name, "agents", "openai.yaml"), "utf8");
      expect(skill).toMatch(/^---\nname: /);
      expect(skill).toContain("description:");
      expect(openai).toContain("display_name:");
      expect(openai).toContain("short_description:");
      expect(openai).toContain("default_prompt:");
    });
  }
});
