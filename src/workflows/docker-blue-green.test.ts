import { describe, expect, it } from "vitest"
import { generateDockerBlueGreen } from "./docker-blue-green"

const baseParams = {
  appName: "herowcode-api",
  dockerNetwork: "herowcode",
  containerPort: "4000",
  vpsPort: "8080",
  envFilePath: "~/whatsapp/.env",
  team: "API" as const,
  environment: "production" as const,
}

describe("generateDockerBlueGreen", () => {
  it("includes app name in workflow name", () => {
    const yaml = generateDockerBlueGreen(baseParams)
    expect(yaml).toContain("name: Deploy herowcode-api")
  })

  it("triggers on v* tags", () => {
    const yaml = generateDockerBlueGreen(baseParams)
    expect(yaml).toContain("tags:")
    expect(yaml).toContain("- 'v*'")
  })

  it("includes workflow_dispatch trigger", () => {
    const yaml = generateDockerBlueGreen(baseParams)
    expect(yaml).toContain("workflow_dispatch:")
  })

  it("includes permissions for GHCR", () => {
    const yaml = generateDockerBlueGreen(baseParams)
    expect(yaml).toContain("permissions:")
    expect(yaml).toContain("contents: read")
    expect(yaml).toContain("packages: write")
  })

  it("includes GHCR login step with GITHUB_TOKEN", () => {
    const yaml = generateDockerBlueGreen(baseParams)
    expect(yaml).toContain("docker/login-action@v3")
    expect(yaml).toContain("registry: ghcr.io")
    // biome-ignore lint/suspicious/noTemplateCurlyInString: GHA expression syntax
    expect(yaml).toContain("${{ secrets.GITHUB_TOKEN }}")
    // biome-ignore lint/suspicious/noTemplateCurlyInString: GHA expression syntax
    expect(yaml).not.toContain("${{ secrets.GHCR_TOKEN }}")
  })

  it("includes docker metadata with app name", () => {
    const yaml = generateDockerBlueGreen(baseParams)
    expect(yaml).toContain("herowcode-api")
    expect(yaml).toContain("docker/metadata-action@v5")
  })

  it("includes build and push step", () => {
    const yaml = generateDockerBlueGreen(baseParams)
    expect(yaml).toContain("docker/build-push-action@v5")
    expect(yaml).toContain("push: true")
  })

  it("includes deploy job with SSH action", () => {
    const yaml = generateDockerBlueGreen(baseParams)
    expect(yaml).toContain("appleboy/ssh-action@v1")
    // biome-ignore lint/suspicious/noTemplateCurlyInString: GHA expression syntax
    expect(yaml).toContain("${{ secrets.VPS_HOST }}")
    // biome-ignore lint/suspicious/noTemplateCurlyInString: GHA expression syntax
    expect(yaml).toContain("${{ secrets.VPS_SSH_KEY }}")
  })

  it("includes network, port binding, and env file", () => {
    const yaml = generateDockerBlueGreen(baseParams)
    expect(yaml).toContain("--network herowcode")
    expect(yaml).toContain("-p 127.0.0.1:8080:4000")
    expect(yaml).toContain("--env-file ~/whatsapp/.env")
  })

  it("creates network if it does not exist", () => {
    const yaml = generateDockerBlueGreen(baseParams)
    expect(yaml).toContain(
      "docker network inspect herowcode > /dev/null 2>&1 || docker network create herowcode",
    )
  })

  it("includes container labels", () => {
    const yaml = generateDockerBlueGreen(baseParams)
    expect(yaml).toContain("--label app=herowcode-api")
    expect(yaml).toContain("--label environment=production")
    expect(yaml).toContain("--label team=API")
  })

  it("reflects team and environment in labels", () => {
    const yaml = generateDockerBlueGreen({
      ...baseParams,
      team: "FRONT",
      environment: "staging",
    })
    expect(yaml).toContain("--label environment=staging")
    expect(yaml).toContain("--label team=FRONT")
  })

  it("includes blue-green container names", () => {
    const yaml = generateDockerBlueGreen(baseParams)
    expect(yaml).toContain("herowcode-api-green")
    expect(yaml).toContain("herowcode-api")
  })

  it("health check uses vpsPort", () => {
    const yaml = generateDockerBlueGreen(baseParams)
    expect(yaml).toContain("http://localhost:8080/health")
  })

  it("includes health check loop", () => {
    const yaml = generateDockerBlueGreen(baseParams)
    expect(yaml).toContain("HEALTHY=false")
    expect(yaml).toContain("sleep 5")
    expect(yaml).toContain("rolling back")
  })

  it("includes volume mount when provided", () => {
    const yaml = generateDockerBlueGreen({
      ...baseParams,
      volumeMount: "herowcode_api_data:/app/data",
    })
    expect(yaml).toContain("-v herowcode_api_data:/app/data")
  })

  it("omits volume flag when not provided", () => {
    const yaml = generateDockerBlueGreen(baseParams)
    expect(yaml).not.toContain("-v ")
  })

  it("includes infra service checks when provided", () => {
    const yaml = generateDockerBlueGreen({
      ...baseParams,
      infraServices: "herowcode-postgres herowcode-redis",
    })
    expect(yaml).toContain("herowcode-postgres herowcode-redis")
    expect(yaml).toContain("not running, aborting deploy")
  })

  it("omits infra checks when not provided", () => {
    const yaml = generateDockerBlueGreen(baseParams)
    expect(yaml).not.toContain("aborting deploy")
  })

  it("uses 'deploy' as default SSH username", () => {
    const yaml = generateDockerBlueGreen(baseParams)
    expect(yaml).toContain("username: deploy")
  })

  it("uses custom SSH username when vpsUser is provided", () => {
    const yaml = generateDockerBlueGreen({ ...baseParams, vpsUser: "ubuntu" })
    expect(yaml).toContain("username: ubuntu")
    expect(yaml).not.toContain("username: deploy")
  })

  it("passes GITHUB_TOKEN as env var to deploy step", () => {
    const yaml = generateDockerBlueGreen(baseParams)
    expect(yaml).toContain("env:")
    // biome-ignore lint/suspicious/noTemplateCurlyInString: GHA expression syntax
    expect(yaml).toContain("GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}")
    expect(yaml).toContain("envs: GITHUB_TOKEN")
  })

  it("logs in to GHCR before docker pull", () => {
    const yaml = generateDockerBlueGreen(baseParams)
    const loginIdx = yaml.indexOf("docker login ghcr.io")
    const pullIdx = yaml.indexOf("docker pull $IMAGE")
    expect(loginIdx).toBeGreaterThan(-1)
    expect(pullIdx).toBeGreaterThan(-1)
    expect(loginIdx).toBeLessThan(pullIdx)
  })

  it("logs out of GHCR after deployment", () => {
    const yaml = generateDockerBlueGreen(baseParams)
    const logoutIdx = yaml.indexOf("docker logout ghcr.io")
    const successIdx = yaml.indexOf("Deployment successful")
    expect(logoutIdx).toBeGreaterThan(-1)
    expect(logoutIdx).toBeLessThan(successIdx)
  })
})
