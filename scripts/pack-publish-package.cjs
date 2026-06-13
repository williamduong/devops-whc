const { execSync } = require("node:child_process");
const path = require("node:path");

const rootDir = path.resolve(__dirname, "..");
const publishPackageDir = path.join(rootDir, "packages", "devops-whc");

execSync("node scripts/prepare-publish-package.cjs", {
  cwd: rootDir,
  stdio: "inherit",
});

execSync("npm pack --dry-run", {
  cwd: publishPackageDir,
  stdio: "inherit",
});
