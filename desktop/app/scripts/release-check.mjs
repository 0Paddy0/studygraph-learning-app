#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { dirname, delimiter, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const appDir = resolve(scriptDir, "..");
const repoRoot = resolve(appDir, "../..");
const env = {
  ...process.env,
  PATH: [join(homedir(), ".cargo", "bin"), process.env.PATH ?? ""].filter(Boolean).join(delimiter),
};

function run(command, args, cwd) {
  console.log(`\n== ${command} ${args.join(" ")} ==`);
  const result = spawnSync(command, args, { cwd, env, stdio: "inherit", shell: process.platform === "win32" });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

run("npm", ["test"], appDir);
run("npm", ["run", "build"], appDir);
run("cargo", ["test", "-p", "studygraph_core"], repoRoot);
