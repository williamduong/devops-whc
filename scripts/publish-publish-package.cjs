const { execSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const rootDir = path.resolve(__dirname, "..");
const publishPackageDir = path.join(rootDir, "packages", "devops-whc");
const publishPackageJson = JSON.parse(fs.readFileSync(path.join(publishPackageDir, "package.json"), "utf8"));

const extraArgs = process.argv.slice(2);
const hasExplicitTag = extraArgs.some((arg, index) => arg === "--tag" || extraArgs[index - 1] === "--tag");
const defaultTagArgs = !hasExplicitTag && publishPackageJson.version.includes("-") ? ["--tag", "next"] : [];
const command = ["npm", "publish", ...defaultTagArgs, ...extraArgs].join(" ");

execSync(command, {
  cwd: publishPackageDir,
  stdio: "inherit",
});