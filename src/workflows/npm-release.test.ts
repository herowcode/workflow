import { describe, expect, it } from "vitest"
import { generateNpmRelease } from "./npm-release"

const baseParams = {
  trigger: "tag" as const,
  registry: "npmjs" as const,
  packageManager: "pnpm" as const,
}

describe("generateNpmRelease", () => {
  it("includes Release name", () => {
    const yaml = generateNpmRelease(baseParams)
    expect(yaml).toContain("name: Release")
  })

  it("uses tag trigger for v* tags", () => {
    const yaml = generateNpmRelease(baseParams)
    expect(yaml).toContain("push:")
    expect(yaml).toContain("- 'v*'")
  })

  it("uses manual dispatch trigger", () => {
    const yaml = generateNpmRelease({ ...baseParams, trigger: "manual" })
    expect(yaml).toContain("workflow_dispatch:")
    expect(yaml).not.toContain("- 'v*'")
  })

  it("uses npmjs registry url", () => {
    const yaml = generateNpmRelease(baseParams)
    expect(yaml).toContain("https://registry.npmjs.org")
  })

  it("uses github packages registry url", () => {
    const yaml = generateNpmRelease({ ...baseParams, registry: "github" })
    expect(yaml).toContain("https://npm.pkg.github.com")
  })

  it("includes install, build, and publish steps", () => {
    const yaml = generateNpmRelease(baseParams)
    expect(yaml).toContain("pnpm install")
    expect(yaml).toContain("pnpm build")
    expect(yaml).toContain("pnpm publish")
  })

  it("uses npm commands for npm package manager", () => {
    const yaml = generateNpmRelease({ ...baseParams, packageManager: "npm" })
    expect(yaml).toContain("npm ci")
    expect(yaml).toContain("npm run build")
    expect(yaml).toContain("npm publish")
  })

  it("includes NODE_AUTH_TOKEN secret", () => {
    const yaml = generateNpmRelease(baseParams)
    // biome-ignore lint/suspicious/noTemplateCurlyInString: GHA expression syntax
    expect(yaml).toContain("${{ secrets.NODE_AUTH_TOKEN }}")
    expect(yaml).toContain("NODE_AUTH_TOKEN:")
  })

  it("includes actions/setup-node with registry-url", () => {
    const yaml = generateNpmRelease(baseParams)
    expect(yaml).toContain("actions/setup-node@v4")
    expect(yaml).toContain("registry-url:")
  })
})
