import { describe, expect, it } from "vitest"
import { generateNpmRelease } from "./npm-release"

const baseNpmjs = {
  trigger: "tag" as const,
  registry: "npmjs" as const,
  packageManager: "pnpm" as const,
}

const baseGithub = {
  trigger: "tag" as const,
  registry: "github" as const,
  packageManager: "pnpm" as const,
}

describe("generateNpmRelease — npmjs (OIDC)", () => {
  it("includes Release name", () => {
    const yaml = generateNpmRelease(baseNpmjs)
    expect(yaml).toContain("name: Release")
  })

  it("uses tag trigger for v* tags", () => {
    const yaml = generateNpmRelease(baseNpmjs)
    expect(yaml).toContain("push:")
    expect(yaml).toContain("- 'v*'")
  })

  it("uses manual dispatch trigger", () => {
    const yaml = generateNpmRelease({ ...baseNpmjs, trigger: "manual" })
    expect(yaml).toContain("workflow_dispatch:")
    expect(yaml).not.toContain("- 'v*'")
  })

  it("includes OIDC permissions block", () => {
    const yaml = generateNpmRelease(baseNpmjs)
    expect(yaml).toContain("permissions:")
    expect(yaml).toContain("id-token: write")
    expect(yaml).toContain("contents: read")
  })

  it("uses npmjs registry url", () => {
    const yaml = generateNpmRelease(baseNpmjs)
    expect(yaml).toContain("https://registry.npmjs.org")
  })

  it("includes pnpm setup step", () => {
    const yaml = generateNpmRelease(baseNpmjs)
    expect(yaml).toContain("pnpm/action-setup@v4")
  })

  it("omits pnpm setup step for npm package manager", () => {
    const yaml = generateNpmRelease({ ...baseNpmjs, packageManager: "npm" })
    expect(yaml).not.toContain("pnpm/action-setup")
  })

  it("upgrades npm before publish", () => {
    const yaml = generateNpmRelease(baseNpmjs)
    expect(yaml).toContain("npm install -g npm@latest")
  })

  it("deletes injected auth token before publish", () => {
    const yaml = generateNpmRelease(baseNpmjs)
    expect(yaml).toContain("npm config delete //registry.npmjs.org/:_authToken")
  })

  it("publishes with provenance flag", () => {
    const yaml = generateNpmRelease(baseNpmjs)
    expect(yaml).toContain("npm publish --provenance --access public")
  })

  it("does not include NODE_AUTH_TOKEN secret", () => {
    const yaml = generateNpmRelease(baseNpmjs)
    expect(yaml).not.toContain("NODE_AUTH_TOKEN")
  })

  it("includes install and build steps", () => {
    const yaml = generateNpmRelease(baseNpmjs)
    expect(yaml).toContain("pnpm install")
    expect(yaml).toContain("pnpm build")
  })

  it("uses npm ci and npm run build for npm package manager", () => {
    const yaml = generateNpmRelease({ ...baseNpmjs, packageManager: "npm" })
    expect(yaml).toContain("npm ci")
    expect(yaml).toContain("npm run build")
  })
})

describe("generateNpmRelease — GitHub Packages (token)", () => {
  it("uses github packages registry url", () => {
    const yaml = generateNpmRelease(baseGithub)
    expect(yaml).toContain("https://npm.pkg.github.com")
  })

  it("does not include OIDC permissions", () => {
    const yaml = generateNpmRelease(baseGithub)
    expect(yaml).not.toContain("id-token: write")
  })

  it("does not upgrade npm", () => {
    const yaml = generateNpmRelease(baseGithub)
    expect(yaml).not.toContain("npm install -g npm@latest")
  })

  it("includes NODE_AUTH_TOKEN secret", () => {
    const yaml = generateNpmRelease(baseGithub)
    // biome-ignore lint/suspicious/noTemplateCurlyInString: GHA expression syntax
    expect(yaml).toContain("${{ secrets.NODE_AUTH_TOKEN }}")
  })

  it("includes pnpm publish for pnpm package manager", () => {
    const yaml = generateNpmRelease(baseGithub)
    expect(yaml).toContain("pnpm publish")
  })

  it("uses npm publish for npm package manager", () => {
    const yaml = generateNpmRelease({ ...baseGithub, packageManager: "npm" })
    expect(yaml).toContain("npm publish")
  })

  it("includes pnpm setup step", () => {
    const yaml = generateNpmRelease(baseGithub)
    expect(yaml).toContain("pnpm/action-setup@v4")
  })
})
