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

function registryUrl(registry: TRegistry): string {
  if (registry === "github") return "https://npm.pkg.github.com"
  return "https://registry.npmjs.org"
}

export function generateNpmRelease(params: INpmReleaseParams): string {
  const { trigger, registry, packageManager } = params
  const installCmd = getInstallCommand(packageManager)
  const cacheKey = packageManager === "npm" ? "npm" : packageManager
  const buildCmd =
    packageManager === "npm" ? "npm run build" : `${packageManager} build`
  const publishCmd =
    packageManager === "npm" ? "npm publish" : `${packageManager} publish`

  return `name: Release

${buildOnBlock(trigger)}

jobs:
  publish:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: '${cacheKey}'
          registry-url: '${registryUrl(registry)}'

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
