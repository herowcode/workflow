import { existsSync } from "node:fs"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import {
  detectCacheMounts,
  detectPackageManager,
  detectPythonManager,
  getInstallCommand,
  getNodeCacheMount,
  getPythonCacheMount,
  hasNodeProject,
} from "./detect"

vi.mock("node:fs", () => ({
  existsSync: vi.fn(),
}))

const mockExistsSync = vi.mocked(existsSync)

describe("detectPackageManager", () => {
  beforeEach(() => {
    mockExistsSync.mockReturnValue(false)
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it("detects pnpm from pnpm-lock.yaml", () => {
    mockExistsSync.mockImplementation((p) =>
      String(p).endsWith("pnpm-lock.yaml"),
    )
    expect(detectPackageManager("/fake/dir")).toBe("pnpm")
  })

  it("detects yarn from yarn.lock", () => {
    mockExistsSync.mockImplementation((p) => String(p).endsWith("yarn.lock"))
    expect(detectPackageManager("/fake/dir")).toBe("yarn")
  })

  it("detects bun from bun.lockb", () => {
    mockExistsSync.mockImplementation((p) => String(p).endsWith("bun.lockb"))
    expect(detectPackageManager("/fake/dir")).toBe("bun")
  })

  it("defaults to npm when no lockfile found", () => {
    mockExistsSync.mockReturnValue(false)
    expect(detectPackageManager("/fake/dir")).toBe("npm")
  })

  it("prefers pnpm over yarn when both exist", () => {
    mockExistsSync.mockReturnValue(true)
    expect(detectPackageManager("/fake/dir")).toBe("pnpm")
  })
})

describe("getInstallCommand", () => {
  it("returns pnpm install for pnpm", () => {
    expect(getInstallCommand("pnpm")).toBe("pnpm install")
  })

  it("returns yarn install for yarn", () => {
    expect(getInstallCommand("yarn")).toBe("yarn install")
  })

  it("returns bun install for bun", () => {
    expect(getInstallCommand("bun")).toBe("bun install")
  })

  it("returns npm ci for npm", () => {
    expect(getInstallCommand("npm")).toBe("npm ci")
  })
})

describe("detectPythonManager", () => {
  beforeEach(() => {
    mockExistsSync.mockReturnValue(false)
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it("detects poetry from poetry.lock", () => {
    mockExistsSync.mockImplementation((p) => String(p).endsWith("poetry.lock"))
    expect(detectPythonManager("/fake/dir")).toBe("poetry")
  })

  it("detects pipenv from Pipfile.lock", () => {
    mockExistsSync.mockImplementation((p) => String(p).endsWith("Pipfile.lock"))
    expect(detectPythonManager("/fake/dir")).toBe("pipenv")
  })

  it("detects pip from requirements.txt", () => {
    mockExistsSync.mockImplementation((p) =>
      String(p).endsWith("requirements.txt"),
    )
    expect(detectPythonManager("/fake/dir")).toBe("pip")
  })

  it("detects pip from pyproject.toml", () => {
    mockExistsSync.mockImplementation((p) =>
      String(p).endsWith("pyproject.toml"),
    )
    expect(detectPythonManager("/fake/dir")).toBe("pip")
  })

  it("returns null when no python manifest is present", () => {
    expect(detectPythonManager("/fake/dir")).toBeNull()
  })
})

describe("cache mounts", () => {
  beforeEach(() => {
    mockExistsSync.mockReturnValue(false)
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it("maps node package managers to cache paths", () => {
    expect(getNodeCacheMount("npm").path).toBe("/root/.npm")
    expect(getNodeCacheMount("pnpm").path).toBe("/root/.local/share/pnpm/store")
    expect(getNodeCacheMount("yarn").path).toBe("/usr/local/share/.cache/yarn")
    expect(getNodeCacheMount("bun").path).toBe("/root/.bun/install/cache")
  })

  it("maps python managers to cache paths", () => {
    expect(getPythonCacheMount("pip").path).toBe("/root/.cache/pip")
    expect(getPythonCacheMount("poetry").path).toBe("/root/.cache/pypoetry")
    expect(getPythonCacheMount("pipenv").path).toBe("/root/.cache/pipenv")
  })

  it("hasNodeProject is true when package.json exists", () => {
    mockExistsSync.mockImplementation((p) => String(p).endsWith("package.json"))
    expect(hasNodeProject("/fake/dir")).toBe(true)
  })

  it("hasNodeProject is false without package.json or lockfile", () => {
    expect(hasNodeProject("/fake/dir")).toBe(false)
  })

  it("detectCacheMounts returns node mount for node project", () => {
    mockExistsSync.mockImplementation(
      (p) =>
        String(p).endsWith("package.json") ||
        String(p).endsWith("pnpm-lock.yaml"),
    )
    const mounts = detectCacheMounts("/fake/dir")
    expect(mounts).toHaveLength(1)
    expect(mounts[0].id).toBe("pnpm-store")
  })

  it("detectCacheMounts returns both mounts for polyglot project", () => {
    mockExistsSync.mockImplementation((p) => {
      const s = String(p)
      return (
        s.endsWith("package.json") ||
        s.endsWith("package-lock.json") ||
        s.endsWith("requirements.txt")
      )
    })
    const mounts = detectCacheMounts("/fake/dir")
    expect(mounts.map((m) => m.id)).toEqual(["npm-cache", "pip-cache"])
  })

  it("detectCacheMounts returns empty list when nothing is detected", () => {
    expect(detectCacheMounts("/fake/dir")).toEqual([])
  })
})
