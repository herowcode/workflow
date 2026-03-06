import { describe, expect, it } from "vitest"
import { generateCiTest } from "./ci-test"

const baseParams = {
  nodeVersion: "20",
  trigger: "push-and-pr" as const,
  packageManager: "pnpm" as const,
}

describe("generateCiTest", () => {
  it("includes CI name", () => {
    const yaml = generateCiTest(baseParams)
    expect(yaml).toContain("name: CI")
  })

  it("uses correct node version", () => {
    const yaml = generateCiTest(baseParams)
    expect(yaml).toContain("node-version: '20'")
  })

  it("uses custom node version", () => {
    const yaml = generateCiTest({ ...baseParams, nodeVersion: "18" })
    expect(yaml).toContain("node-version: '18'")
  })

  it("uses pnpm install command", () => {
    const yaml = generateCiTest(baseParams)
    expect(yaml).toContain("pnpm install")
  })

  it("uses yarn install command", () => {
    const yaml = generateCiTest({ ...baseParams, packageManager: "yarn" })
    expect(yaml).toContain("yarn install")
  })

  it("uses bun install command", () => {
    const yaml = generateCiTest({ ...baseParams, packageManager: "bun" })
    expect(yaml).toContain("bun install")
  })

  it("uses npm ci command", () => {
    const yaml = generateCiTest({ ...baseParams, packageManager: "npm" })
    expect(yaml).toContain("npm ci")
  })

  it("sets push-and-pr trigger correctly", () => {
    const yaml = generateCiTest(baseParams)
    expect(yaml).toContain("push:")
    expect(yaml).toContain("branches:")
    expect(yaml).toContain("- main")
    expect(yaml).toContain("pull_request:")
  })

  it("sets push-only trigger correctly", () => {
    const yaml = generateCiTest({ ...baseParams, trigger: "push-only" })
    expect(yaml).toContain("push:")
    expect(yaml).not.toContain("pull_request:")
  })

  it("sets pr-only trigger correctly", () => {
    const yaml = generateCiTest({ ...baseParams, trigger: "pr-only" })
    expect(yaml).toContain("pull_request:")
    expect(yaml).not.toContain("branches:")
  })

  it("includes lint and test steps", () => {
    const yaml = generateCiTest(baseParams)
    expect(yaml).toContain("Lint")
    expect(yaml).toContain("Test")
  })

  it("uses correct cache for pnpm", () => {
    const yaml = generateCiTest(baseParams)
    expect(yaml).toContain("cache: 'pnpm'")
  })

  it("uses correct cache for npm", () => {
    const yaml = generateCiTest({ ...baseParams, packageManager: "npm" })
    expect(yaml).toContain("cache: 'npm'")
  })
})
