import { existsSync } from "node:fs"
import { join } from "node:path"

export type TPackageManager = "pnpm" | "yarn" | "bun" | "npm"
export type TPythonManager = "poetry" | "pipenv" | "pip"

export interface ICacheMount {
  id: string
  path: string
  lockfile: string
}

const NODE_LOCKFILES = [
  "pnpm-lock.yaml",
  "yarn.lock",
  "bun.lockb",
  "package-lock.json",
]

export function detectPackageManager(cwd = process.cwd()): TPackageManager {
  if (existsSync(join(cwd, "pnpm-lock.yaml"))) return "pnpm"
  if (existsSync(join(cwd, "yarn.lock"))) return "yarn"
  if (existsSync(join(cwd, "bun.lockb"))) return "bun"
  return "npm"
}

export function hasNodeProject(cwd = process.cwd()): boolean {
  if (existsSync(join(cwd, "package.json"))) return true
  return NODE_LOCKFILES.some((file) => existsSync(join(cwd, file)))
}

export function detectPythonManager(
  cwd = process.cwd(),
): TPythonManager | null {
  if (existsSync(join(cwd, "poetry.lock"))) return "poetry"
  if (
    existsSync(join(cwd, "Pipfile.lock")) ||
    existsSync(join(cwd, "Pipfile"))
  ) {
    return "pipenv"
  }
  if (
    existsSync(join(cwd, "requirements.txt")) ||
    existsSync(join(cwd, "pyproject.toml"))
  ) {
    return "pip"
  }
  return null
}

export function getInstallCommand(pm: TPackageManager): string {
  if (pm === "pnpm") return "pnpm install"
  if (pm === "yarn") return "yarn install"
  if (pm === "bun") return "bun install"
  return "npm ci"
}

export function getNodeCacheMount(pm: TPackageManager): ICacheMount {
  if (pm === "pnpm") {
    return {
      id: "pnpm-store",
      path: "/root/.local/share/pnpm/store",
      lockfile: "pnpm-lock.yaml",
    }
  }
  if (pm === "yarn") {
    return {
      id: "yarn-cache",
      path: "/usr/local/share/.cache/yarn",
      lockfile: "yarn.lock",
    }
  }
  if (pm === "bun") {
    return {
      id: "bun-cache",
      path: "/root/.bun/install/cache",
      lockfile: "bun.lockb",
    }
  }
  return {
    id: "npm-cache",
    path: "/root/.npm",
    lockfile: "package-lock.json",
  }
}

export function getPythonCacheMount(pm: TPythonManager): ICacheMount {
  if (pm === "poetry") {
    return {
      id: "poetry-cache",
      path: "/root/.cache/pypoetry",
      lockfile: "poetry.lock",
    }
  }
  if (pm === "pipenv") {
    return {
      id: "pipenv-cache",
      path: "/root/.cache/pipenv",
      lockfile: "Pipfile.lock",
    }
  }
  return {
    id: "pip-cache",
    path: "/root/.cache/pip",
    lockfile: "requirements.txt",
  }
}

export function detectCacheMounts(cwd = process.cwd()): ICacheMount[] {
  const mounts: ICacheMount[] = []
  if (hasNodeProject(cwd)) {
    mounts.push(getNodeCacheMount(detectPackageManager(cwd)))
  }
  const py = detectPythonManager(cwd)
  if (py) mounts.push(getPythonCacheMount(py))
  return mounts
}
