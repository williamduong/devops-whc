const { execSync } = require("node:child_process");
const path = require("node:path");

const rootDir = path.resolve(__dirname, "..");
const publishPackageDir = path.join(rootDir, "packages", "devops-whc");

execSync("npm pack --dry-run", {
  cwd: publishPackageDir,
  stdio: "inherit",
});
