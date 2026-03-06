import { existsSync } from "node:fs"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { detectPackageManager, getInstallCommand } from "./detect"

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
