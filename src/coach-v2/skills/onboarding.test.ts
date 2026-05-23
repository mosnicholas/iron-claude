/**
 * Onboarding skill registration test.
 *
 * Verifies that the onboarding skill is wired into the catalog and that
 * its markdown file is loadable and non-empty. End-to-end behavioral
 * checks (does the model actually follow the playbook?) live in the
 * separate scenario suite that calls a real model.
 */

import { existsSync, readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { findSkill, readSkillBody, SKILLS } from "./index.js";

const here = dirname(fileURLToPath(import.meta.url));

describe("onboarding skill", () => {
  it("is registered in the skills catalog", () => {
    const names = SKILLS.map((s) => s.name);
    expect(names).toContain("onboarding");
  });

  it("findSkill returns the onboarding entry", () => {
    const skill = findSkill("onboarding");
    expect(skill).toBeDefined();
    expect(skill?.file).toBe("onboarding.md");
  });

  it("has a corresponding markdown file on disk", () => {
    const path = join(here, "onboarding.md");
    expect(existsSync(path)).toBe(true);
  });

  it("loads a non-empty body via readSkillBody", () => {
    const skill = findSkill("onboarding")!;
    const body = readSkillBody(skill);
    expect(body.length).toBeGreaterThan(200);
    expect(body).toMatch(/onboarding/i);
  });

  it("markdown file is non-empty when read directly", () => {
    const body = readFileSync(join(here, "onboarding.md"), "utf-8");
    expect(body.trim().length).toBeGreaterThan(0);
  });
});
