import type { TPackageManager } from "../detect"
import { getInstallCommand } from "../detect"

export type TTrigger = "push-and-pr" | "push-only" | "pr-only"

export interface ICiTestParams {
  nodeVersion: string
  trigger: TTrigger
  packageManager: TPackageManager
}

function buildOnBlock(trigger: TTrigger): string {
  if (trigger === "push-and-pr") {
    return `on:
  push:
    branches:
      - main
  pull_request:`
  }
  if (trigger === "push-only") {
    return `on:
  push:
    branches:
      - main`
  }
  return `on:
  pull_request:`
}

export function generateCiTest(params: ICiTestParams): string {
  const { nodeVersion, trigger, packageManager } = params
  const installCmd = getInstallCommand(packageManager)
  const cacheKey = packageManager === "npm" ? "npm" : packageManager

  return `name: CI

${buildOnBlock(trigger)}

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '${nodeVersion}'
          cache: '${cacheKey}'

      - name: Install dependencies
        run: ${installCmd}

      - name: Lint
        run: ${packageManager === "npm" ? "npm run lint" : `${packageManager} lint`}

      - name: Test
        run: ${packageManager === "npm" ? "npm run test:run" : `${packageManager} test:run`}
`
}
