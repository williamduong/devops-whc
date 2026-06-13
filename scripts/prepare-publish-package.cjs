const fs = require("node:fs");
const path = require("node:path");
const { execSync } = require("node:child_process");

const rootDir = path.resolve(__dirname, "..");
const publishPackageDir = path.join(rootDir, "packages", "devops-whc");

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function cleanPath(targetPath) {
  fs.rmSync(targetPath, { recursive: true, force: true });
}

function copyFileFromRoot(relativePath) {
  const src = path.join(rootDir, relativePath);
  const dest = path.join(publishPackageDir, relativePath);
  ensureDir(path.dirname(dest));
  fs.copyFileSync(src, dest);
}

function copyFileToPublish(relativeSrcPath, relativeDestPath) {
  const src = path.join(rootDir, relativeSrcPath);
  const dest = path.join(publishPackageDir, relativeDestPath);
  ensureDir(path.dirname(dest));
  fs.copyFileSync(src, dest);
}

function copyDirFromRoot(relativePath) {
  const src = path.join(rootDir, relativePath);
  const dest = path.join(publishPackageDir, relativePath);
  cleanPath(dest);
  ensureDir(path.dirname(dest));
  fs.cpSync(src, dest, { recursive: true });
}

function syncVersionFromRootPackage() {
  const rootPackagePath = path.join(rootDir, "package.json");
  const publishPackagePath = path.join(publishPackageDir, "package.json");

  const rootPackage = JSON.parse(fs.readFileSync(rootPackagePath, "utf8"));
  const publishPackage = JSON.parse(fs.readFileSync(publishPackagePath, "utf8"));

  publishPackage.version = rootPackage.version;

  fs.writeFileSync(publishPackagePath, JSON.stringify(publishPackage, null, 2) + "\n", "utf8");
}

function main() {
  if (!fs.existsSync(publishPackageDir)) {
    throw new Error("Publish package folder not found: packages/devops-whc");
  }

  // Always build from root first so publish package receives fresh dist output.
  execSync("npm run build", {
    cwd: rootDir,
    stdio: "inherit",
  });

  syncVersionFromRootPackage();

  copyDirFromRoot("dist");
  copyFileFromRoot("scripts/start-whc.cjs");
  copyFileFromRoot("scripts/prepare-first-time.cjs");
  copyFileToPublish("README.npm.md", "README.md");
  copyFileFromRoot("AGENT_USAGE.md");
  copyFileFromRoot("WHC_REQUIREMENTS.md");
  copyFileFromRoot("LICENSE");

  console.log("[prepare-publish-package] Synced publish artifacts into packages/devops-whc");
}

main();
