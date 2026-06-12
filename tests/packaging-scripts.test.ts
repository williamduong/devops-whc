import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const rootDir = process.cwd();

describe("packaging scripts", () => {
  it("syncs start-whc helper and renamed docs into publish package", () => {
    const scriptPath = join(rootDir, "scripts", "prepare-publish-package.cjs");
    const script = readFileSync(scriptPath, "utf8");

    expect(script).toContain('copyFileFromRoot("scripts/start-whc.cjs")');
    expect(script).toContain('copyFileFromRoot("AGENT_USAGE.md")');
    expect(script).toContain('copyFileFromRoot("WHC_REQUIREMENTS.md")');
  });

  it("publish package start command points to start-whc helper", () => {
    const pkgPath = join(rootDir, "packages", "devops-whc", "package.json");
    const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as {
      scripts?: Record<string, string>;
      files?: string[];
    };

    expect(pkg.scripts?.start).toBe("node scripts/start-whc.cjs");
    expect(pkg.files).toContain("scripts/start-whc.cjs");
    expect(pkg.files).toContain("AGENT_USAGE.md");
    expect(pkg.files).toContain("WHC_REQUIREMENTS.md");
  });
});
