import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const rootDir = process.cwd();

describe("packaging scripts", () => {
  it("syncs start-whc helper and renamed docs into publish package", () => {
    const scriptPath = join(rootDir, "scripts", "prepare-publish-package.cjs");
    const script = readFileSync(scriptPath, "utf8");

    expect(script).toContain('copyFileFromRoot("scripts/start-whc.cjs")');
    expect(script).toContain('copyFileToPublish("README.npm.md", "README.md")');
  });

  it("publish package surface stays end-user focused", () => {
    const pkgPath = join(rootDir, "packages", "devops-whc", "package.json");
    const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as {
      scripts?: Record<string, string>;
      files?: string[];
    };

    expect(pkg.scripts?.start).toBe("node scripts/start-whc.cjs");
    expect(pkg.scripts?.["check:generic"]).toBe("node dist/index.js --check-generic");
    expect(pkg.files).toContain("scripts/start-whc.cjs");
    expect(pkg.files).toContain("README.md");
    expect(pkg.files).not.toContain("AGENT_USAGE.md");
    expect(pkg.files).not.toContain("WHC_REQUIREMENTS.md");
    expect(pkg.files).not.toContain("scripts/prepare-first-time.cjs");
    expect(pkg.scripts?.prepack).toBeUndefined();
    expect(pkg.scripts?.publish).toBeUndefined();
  });
});
