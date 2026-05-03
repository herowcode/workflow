import { spawnSync } from "node:child_process"
import * as p from "@clack/prompts"
import pc from "picocolors"
import { detectCacheMounts, detectPackageManager } from "./detect"
import { generateCiTest } from "./workflows/ci-test"
import {
  generateDockerBlueGreen,
  getAppTypePresets,
  type TAppType,
} from "./workflows/docker-blue-green"
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
      message:
        "Docker network(s), comma-separated (e.g. herowcode or herowcode,shared-services)",
      placeholder: "app-network,shared-network",
      validate: (v) =>
        v
          .split(",")
          .map((name) => name.trim())
          .filter(Boolean).length > 0
          ? undefined
          : "At least one network name is required",
    })
    if (p.isCancel(dockerNetwork)) {
      p.cancel("Operation cancelled.")
      process.exit(0)
    }

    const dockerNetworks = dockerNetwork
      .split(",")
      .map((name) => name.trim())
      .filter(Boolean)

    const useTraefik = await p.confirm({
      message: "Expose this app via Traefik (reverse proxy)?",
      initialValue: true,
    })
    if (p.isCancel(useTraefik)) {
      p.cancel("Operation cancelled.")
      process.exit(0)
    }

    let traefikDomain: string | undefined
    if (useTraefik) {
      const selectedDomain = await p.text({
        message: "Public domain for this app (e.g. api.example.com)",
        placeholder: "app.example.com",
        validate: (v) =>
          v.trim().includes(".") ? undefined : "Domain must contain a dot",
      })
      if (p.isCancel(selectedDomain)) {
        p.cancel("Operation cancelled.")
        process.exit(0)
      }
      traefikDomain = selectedDomain.trim()
    }

    const exposesPort = await p.confirm({
      message: useTraefik
        ? "Does this app listen on a container port? (Traefik routes to it)"
        : "Does this app expose a port?",
      initialValue: true,
    })
    if (p.isCancel(exposesPort)) {
      p.cancel("Operation cancelled.")
      process.exit(0)
    }

    let containerPort: string | undefined
    let vpsPort: string | undefined

    if (exposesPort) {
      const selectedContainerPort = await p.text({
        message:
          "Container port — internal port the app listens on (e.g. 4000)",
        placeholder: "3000",
        validate: (v) =>
          /^\d+$/.test(v.trim()) ? undefined : "Port must be a number",
      })
      if (p.isCancel(selectedContainerPort)) {
        p.cancel("Operation cancelled.")
        process.exit(0)
      }

      containerPort = (selectedContainerPort as string).trim()

      const publishOnHost = useTraefik
        ? await p.confirm({
            message:
              "Also publish on 127.0.0.1 of the VPS? (only useful for local debug)",
            initialValue: false,
          })
        : true
      if (p.isCancel(publishOnHost)) {
        p.cancel("Operation cancelled.")
        process.exit(0)
      }

      if (publishOnHost) {
        const selectedVpsPort = await p.text({
          message:
            "VPS port — port exposed on 127.0.0.1 of the VPS (e.g. 8080)",
          placeholder: containerPort,
          validate: (v) =>
            /^\d+$/.test(v.trim()) ? undefined : "Port must be a number",
        })
        if (p.isCancel(selectedVpsPort)) {
          p.cancel("Operation cancelled.")
          process.exit(0)
        }
        vpsPort = (selectedVpsPort as string).trim()
      }
    }

    const envFilePath = await p.text({
      message: "Env file path on VPS (optional, e.g. ~/api/.env)",
      placeholder: "~/.env",
    })
    if (p.isCancel(envFilePath)) {
      p.cancel("Operation cancelled.")
      process.exit(0)
    }
    const normalizedEnvFilePath =
      (envFilePath as string).trim() || undefined

    const vpsUser = await p.text({
      message: "VPS SSH username (e.g. ubuntu, deploy)",
      placeholder: "deploy",
    })
    if (p.isCancel(vpsUser)) {
      p.cancel("Operation cancelled.")
      process.exit(0)
    }

    const team = await p.select({
      message: "Team responsible for this app",
      options: [
        { value: "FRONT", label: "FRONT" },
        { value: "BACK", label: "BACK" },
        { value: "API", label: "API" },
        { value: "BOT", label: "BOT" },
        { value: "OTHER", label: "OTHER" },
      ],
    })
    if (p.isCancel(team)) {
      p.cancel("Operation cancelled.")
      process.exit(0)
    }

    const environment = await p.select({
      message: "Deployment environment",
      options: [
        { value: "production", label: "production" },
        { value: "staging", label: "staging" },
        { value: "development", label: "development" },
      ],
    })
    if (p.isCancel(environment)) {
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

    let healthEndpoint: string | undefined = "/health"
    if (exposesPort) {
      const hasHealthEndpoint = await p.confirm({
        message: "Does your app have a health check endpoint?",
        initialValue: true,
      })
      if (p.isCancel(hasHealthEndpoint)) {
        p.cancel("Operation cancelled.")
        process.exit(0)
      }

      if (hasHealthEndpoint) {
        const healthPath = await p.text({
          message: "Health endpoint path",
          placeholder: "/health",
          initialValue: "/health",
        })
        if (p.isCancel(healthPath)) {
          p.cancel("Operation cancelled.")
          process.exit(0)
        }
        healthEndpoint = healthPath.trim() || "/health"
      } else {
        healthEndpoint = ""
      }
    } else {
      healthEndpoint = ""
    }

    let appType: TAppType = "other"
    let traefikMiddlewares: string[] | undefined
    if (useTraefik) {
      const selectedAppType = await p.select({
        message: "Application type (sets cache + middleware presets)",
        options: [
          {
            value: "spa",
            label: "SPA (React / Vue / Angular)",
            hint: "hash-immutable assets + no-store HTML",
          },
          {
            value: "nextjs",
            label: "Next.js / Nuxt",
            hint: "/_next/static immutable, /_next/image cached",
          },
          {
            value: "node-api",
            label: "Node API",
            hint: "no-store + ratelimit",
          },
          {
            value: "python",
            label: "Python (Django / Flask)",
            hint: "/static + /media presets",
          },
          {
            value: "static",
            label: "Static site",
            hint: "7d default + immutable hashed assets",
          },
          {
            value: "other",
            label: "Other / custom",
            hint: "no presets, pick middlewares manually",
          },
        ],
      })
      if (p.isCancel(selectedAppType)) {
        p.cancel("Operation cancelled.")
        process.exit(0)
      }
      appType = selectedAppType as TAppType

      const presets = getAppTypePresets(appType)
      const presetsHint =
        presets.rootMiddlewares.length > 0
          ? presets.rootMiddlewares.join(", ")
          : "(none)"

      const customize = await p.confirm({
        message: `Customize root-router middlewares? Defaults: ${presetsHint}`,
        initialValue: appType === "other",
      })
      if (p.isCancel(customize)) {
        p.cancel("Operation cancelled.")
        process.exit(0)
      }

      if (customize) {
        const selectedMiddlewares = await p.multiselect({
          message:
            "Root-router middlewares (Space to toggle, Enter to confirm)",
          options: [
            { value: "compress", label: "compress" },
            { value: "sec-headers", label: "sec-headers" },
            {
              value: "api-ratelimit",
              label: "api-ratelimit (20 r/s burst 50)",
            },
            { value: "body-150m", label: "body-150m (150MB body limit)" },
            {
              value: "cc-immutable",
              label: "cc-immutable (1y immutable assets)",
            },
            { value: "cc-no-store", label: "cc-no-store (HTML SPA shell)" },
            { value: "cc-media", label: "cc-media (30d images)" },
            { value: "cc-public", label: "cc-public (7d generic statics)" },
            {
              value: "cc-next-image",
              label: "cc-next-image (Next.js /_next/image)",
            },
          ],
          initialValues:
            presets.rootMiddlewares.length > 0
              ? presets.rootMiddlewares
              : ["compress", "sec-headers"],
          required: false,
        })
        if (p.isCancel(selectedMiddlewares)) {
          p.cancel("Operation cancelled.")
          process.exit(0)
        }
        traefikMiddlewares = selectedMiddlewares as string[]
      }
    }

    content = generateDockerBlueGreen({
      appName: appName.trim(),
      dockerNetworks,
      containerPort,
      vpsPort,
      envFilePath: normalizedEnvFilePath,
      team: team as "FRONT" | "BACK" | "API" | "BOT" | "OTHER",
      environment: environment as "production" | "staging" | "development",
      vpsUser: (vpsUser as string)?.trim() || undefined,
      volumeMount: volumeMount?.trim() || undefined,
      infraServices: infraServices?.trim() || undefined,
      healthEndpoint,
      cacheMounts: detectCacheMounts(),
      useTraefik,
      traefikDomain,
      traefikMiddlewares,
      appType,
    })
    filename = "deploy"
    secrets = ["VPS_HOST", "VPS_SSH_KEY"]
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
