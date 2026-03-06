import { existsSync } from "node:fs"
import { join } from "node:path"

export type TPackageManager = "pnpm" | "yarn" | "bun" | "npm"

export function detectPackageManager(cwd = process.cwd()): TPackageManager {
  if (existsSync(join(cwd, "pnpm-lock.yaml"))) return "pnpm"
  if (existsSync(join(cwd, "yarn.lock"))) return "yarn"
  if (existsSync(join(cwd, "bun.lockb"))) return "bun"
  return "npm"
}

export function getInstallCommand(pm: TPackageManager): string {
  if (pm === "pnpm") return "pnpm install"
  if (pm === "yarn") return "yarn install"
  if (pm === "bun") return "bun install"
  return "npm ci"
}
