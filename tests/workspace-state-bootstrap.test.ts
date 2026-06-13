import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ensureWorkspaceBootstrap } from "../src/state/workspace-state";

describe("ensureWorkspaceBootstrap", () => {
  it("creates hidden state and project-local env scaffold", () => {
    const projectRoot = mkdtempSync(join(tmpdir(), "whc-bootstrap-"));
    const appRoot = join(projectRoot, "wordpress");
    const result = ensureWorkspaceBootstrap(appRoot, {
      localProjectRoot: projectRoot,
      localAppPath: "wordpress",
    });

    expect(result.stateRootRelative).toBe(".whc");
    expect(existsSync(result.pipelineStatusFile)).toBe(true);
    expect(existsSync(result.envFile)).toBe(true);
    expect(existsSync(result.envExampleFile)).toBe(true);
    expect(readFileSync(result.envFile, "utf8")).toContain(`WHC_LOCAL_PROJECT_ROOT=${projectRoot}`);
    expect(readFileSync(result.envFile, "utf8")).toContain("WHC_LOCAL_APP_PATH=wordpress");
    expect(result.envFile).toContain(`${appRoot}\\.whc\\env\\whc.env`);
  });

  it("supports project-root-as-app-root when app-path is omitted", () => {
    const projectRoot = mkdtempSync(join(tmpdir(), "whc-bootstrap-root-"));
    const result = ensureWorkspaceBootstrap(projectRoot, {
      localProjectRoot: projectRoot,
    });

    expect(existsSync(result.pipelineStatusFile)).toBe(true);
    expect(readFileSync(result.envFile, "utf8")).toContain(`WHC_LOCAL_PROJECT_ROOT=${projectRoot}`);
    expect(readFileSync(result.envFile, "utf8")).toContain("WHC_LOCAL_APP_PATH=");
    expect(result.envFile).toContain(`${projectRoot}\\.whc\\env\\whc.env`);
  });
});
