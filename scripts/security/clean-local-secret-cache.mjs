import { existsSync, realpathSync, rmSync } from "node:fs";
import { relative, resolve, sep } from "node:path";

const workspace = realpathSync(process.cwd());
const targets = [
  resolve(workspace, ".next", "cache", "turbopack"),
  resolve(workspace, ".next", "dev", "cache", "turbopack"),
];

for (const target of targets) {
  const targetRelative = relative(workspace, target);
  if (
    !targetRelative ||
    targetRelative === ".." ||
    targetRelative.startsWith(`..${sep}`)
  ) {
    throw new Error(
      `Refusing to remove a path outside the workspace: ${target}`,
    );
  }

  if (!existsSync(target)) {
    console.log(`[secret-cache] not present: ${targetRelative}`);
    continue;
  }

  rmSync(target, { recursive: true, force: false });
  console.log(`[secret-cache] removed generated cache: ${targetRelative}`);
}
