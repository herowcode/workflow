import { spawnSync } from "node:child_process"
import * as p from "@clack/prompts"
import pc from "picocolors"
import { detectPackageManager } from "./detect"
import { generateCiTest } from "./workflows/ci-test"
import { generateDockerBlueGreen } from "./workflows/docker-blue-green"
import { generateNpmRelease } from "./workflows/npm-release"
import { writeWorkflow } from "./write"

function checkSecrets(required: string[]): {
  configured: string[]
  missing: string[]
} {
  if (required.length === 0) return { configured: [], missing: [] }

  const inGitRepo =
    spawnSync("git", ["rev-parse", "--git-dir"], { stdio: "ignore" }).status ===
    0
  if (!inGitRepo) return { configured: [], missing: required }

  const ghAvailable =
    spawnSync("gh", ["--version"], { stdio: "ignore" }).status === 0
  if (!ghAvailable) return { configured: [], missing: required }

  const result = spawnSync("gh", ["secret", "list", "--json", "name"], {
    encoding: "utf8",
  })
  if (result.status !== 0) return { configured: [], missing: required }

  try {
    const list = JSON.parse(result.stdout) as Array<{ name: string }>
    const names = list.map((s) => s.name)
    return {
      configured: required.filter((s) => names.includes(s)),
      missing: required.filter((s) => !names.includes(s)),
    }
  } catch {
    return { configured: [], missing: required }
  }
}

function secretsSummary(secrets: string[]): string {
  if (secrets.length === 0) return ""

  const { configured, missing } = checkSecrets(secrets)
  const resolvedByGh = configured.length + missing.length === secrets.length

  if (resolvedByGh) {
    const lines = [
      "",
      "",
      "  Required GitHub secrets:",
      ...configured.map(
        (s) => `    ${pc.green("✓")} ${pc.dim(s)} ${pc.dim("(already set)")}`,
      ),
      ...missing.map((s) => `    ${pc.yellow("•")} ${pc.yellow(s)}`),
    ]
    return lines.join("\n")
  }

  return `\n\n  Required GitHub secrets:\n${secrets.map((s) => `    • ${pc.yellow(s)}`).join("\n")}`
}

export async function main() {
  p.intro(pc.bgCyan(pc.black(" @herowcode/workflow ")))

  const workflow = await p.select({
    message: "Which workflow do you want to add?",
    options: [
      { value: "docker-blue-green", label: "Docker blue-green deploy" },
      { value: "ci-test", label: "CI test runner" },
      { value: "npm-release", label: "NPM package release" },
    ],
  })

  if (p.isCancel(workflow)) {
    p.cancel("Operation cancelled.")
    process.exit(0)
  }

  let content: string
  let filename: string
  let secrets: string[]

  if (workflow === "docker-blue-green") {
    const appName = await p.text({
      message: "App name (e.g. herowcode-api)",
      placeholder: "my-app",
      validate: (v) => (v.trim() ? undefined : "App name is required"),
    })
    if (p.isCancel(appName)) {
      p.cancel("Operation cancelled.")
      process.exit(0)
    }

    const dockerNetwork = await p.text({
      message: "Docker network name (e.g. herowcode)",
      placeholder: "app-network",
      validate: (v) => (v.trim() ? undefined : "Network name is required"),
    })
    if (p.isCancel(dockerNetwork)) {
      p.cancel("Operation cancelled.")
      process.exit(0)
    }

    const port = await p.text({
      message: "Container port (e.g. 4000)",
      placeholder: "3000",
      validate: (v) =>
        /^\d+$/.test(v.trim()) ? undefined : "Port must be a number",
    })
    if (p.isCancel(port)) {
      p.cancel("Operation cancelled.")
      process.exit(0)
    }

    const envFilePath = await p.text({
      message: "Env file path on VPS (e.g. ~/api/.env)",
      placeholder: "~/.env",
      validate: (v) => (v.trim() ? undefined : "Env file path is required"),
    })
    if (p.isCancel(envFilePath)) {
      p.cancel("Operation cancelled.")
      process.exit(0)
    }

    const volumeMount = await p.text({
      message: "Volume mount (optional, e.g. myapp_auth:/app/auth)",
      placeholder: "Leave empty to skip",
    })
    if (p.isCancel(volumeMount)) {
      p.cancel("Operation cancelled.")
      process.exit(0)
    }

    const infraServices = await p.text({
      message:
        "Infrastructure services to health-check (optional, space-separated)",
      placeholder: "Leave empty to skip",
    })
    if (p.isCancel(infraServices)) {
      p.cancel("Operation cancelled.")
      process.exit(0)
    }

    content = generateDockerBlueGreen({
      appName: appName.trim(),
      dockerNetwork: dockerNetwork.trim(),
      port: port.trim(),
      envFilePath: envFilePath.trim(),
      volumeMount: volumeMount?.trim() || undefined,
      infraServices: infraServices?.trim() || undefined,
    })
    filename = "deploy"
    secrets = ["VPS_HOST", "VPS_SSH_KEY", "GHCR_TOKEN"]
  } else if (workflow === "ci-test") {
    const nodeVersion = await p.text({
      message: "Node.js version",
      placeholder: "24",
      initialValue: "24",
    })
    if (p.isCancel(nodeVersion)) {
      p.cancel("Operation cancelled.")
      process.exit(0)
    }

    const trigger = await p.select({
      message: "Trigger on",
      options: [
        {
          value: "push-and-pr",
          label: "Push to main + pull requests (recommended)",
        },
        { value: "push-only", label: "Push to main only" },
        { value: "pr-only", label: "Pull requests only" },
      ],
    })
    if (p.isCancel(trigger)) {
      p.cancel("Operation cancelled.")
      process.exit(0)
    }

    const pm = detectPackageManager()
    content = generateCiTest({
      nodeVersion: nodeVersion.trim() || "24",
      trigger: trigger as "push-and-pr" | "push-only" | "pr-only",
      packageManager: pm,
    })
    filename = "ci"
    secrets = []
  } else {
    const trigger = await p.select({
      message: "Release trigger",
      options: [
        { value: "tag", label: "Tag push (v*)" },
        { value: "manual", label: "Manual dispatch (workflow_dispatch)" },
      ],
    })
    if (p.isCancel(trigger)) {
      p.cancel("Operation cancelled.")
      process.exit(0)
    }

    const registry = await p.select({
      message: "Publish registry",
      options: [
        { value: "npmjs", label: "npmjs.com (OIDC — no secrets required)" },
        { value: "github", label: "GitHub Packages" },
      ],
    })
    if (p.isCancel(registry)) {
      p.cancel("Operation cancelled.")
      process.exit(0)
    }

    const pm = detectPackageManager()
    content = generateNpmRelease({
      trigger: trigger as "tag" | "manual",
      registry: registry as "npmjs" | "github",
      packageManager: pm,
    })
    filename = "release"
    secrets = registry === "npmjs" ? [] : ["NODE_AUTH_TOKEN"]
  }

  const filePath = writeWorkflow(filename, content)

  p.outro(
    `${pc.green("✓")} Written to ${pc.cyan(filePath)}${secretsSummary(secrets)}`,
  )
}
