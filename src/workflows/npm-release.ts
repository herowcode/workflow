import type { TPackageManager } from "../detect"
import { getInstallCommand } from "../detect"

export type TReleaseTrigger = "tag" | "manual"
export type TRegistry = "npmjs" | "github"

export interface INpmReleaseParams {
  trigger: TReleaseTrigger
  registry: TRegistry
  packageManager: TPackageManager
}

function buildOnBlock(trigger: TReleaseTrigger): string {
  if (trigger === "tag") {
    return `on:
  push:
    tags:
      - 'v*'`
  }
  return `on:
  workflow_dispatch:`
}

function pnpmSetupStep(packageManager: TPackageManager): string {
  if (packageManager !== "pnpm") return ""
  return `
      - name: Setup pnpm
        uses: pnpm/action-setup@v4
`
}

export function generateNpmRelease(params: INpmReleaseParams): string {
  const { trigger, registry, packageManager } = params
  const installCmd = getInstallCommand(packageManager)
  const cacheKey = packageManager === "npm" ? "npm" : packageManager
  const buildCmd =
    packageManager === "npm" ? "npm run build" : `${packageManager} build`

  if (registry === "npmjs") {
    return `name: Release

${buildOnBlock(trigger)}

permissions:
  contents: read
  id-token: write

jobs:
  publish:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
${pnpmSetupStep(packageManager)}
      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: '${cacheKey}'
          registry-url: 'https://registry.npmjs.org'

      - name: Upgrade npm
        run: npm install -g npm@latest

      - name: Install dependencies
        run: ${installCmd}

      - name: Build
        run: ${buildCmd}

      - name: Remove injected auth token to enable OIDC
        run: npm config delete //registry.npmjs.org/:_authToken

      - name: Publish
        run: npm publish --provenance --access public
`
  }

  const publishCmd =
    packageManager === "npm" ? "npm publish" : `${packageManager} publish`

  return `name: Release

${buildOnBlock(trigger)}

jobs:
  publish:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
${pnpmSetupStep(packageManager)}
      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: '${cacheKey}'
          registry-url: 'https://npm.pkg.github.com'

      - name: Install dependencies
        run: ${installCmd}

      - name: Build
        run: ${buildCmd}

      - name: Publish
        run: ${publishCmd}
        env:
          NODE_AUTH_TOKEN: \${{ secrets.NODE_AUTH_TOKEN }}
`
}
