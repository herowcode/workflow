import { describe, expect, it } from "vitest"
import { generateDockerBlueGreen } from "./docker-blue-green"

const baseParams = {
  appName: "herowcode-api",
  dockerNetwork: "herowcode",
  port: "4000",
  envFilePath: "~/whatsapp/.env",
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

  it("includes GHCR login step", () => {
    const yaml = generateDockerBlueGreen(baseParams)
    expect(yaml).toContain("docker/login-action@v3")
    expect(yaml).toContain("registry: ghcr.io")
    // biome-ignore lint/suspicious/noTemplateCurlyInString: GHA expression syntax
    expect(yaml).toContain("${{ secrets.GHCR_TOKEN }}")
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

  it("includes network, port, and env file", () => {
    const yaml = generateDockerBlueGreen(baseParams)
    expect(yaml).toContain("--network herowcode")
    expect(yaml).toContain("-p 127.0.0.1:4000:4000")
    expect(yaml).toContain("--env-file ~/whatsapp/.env")
  })

  it("includes blue-green container names", () => {
    const yaml = generateDockerBlueGreen(baseParams)
    expect(yaml).toContain("herowcode-api-green")
    expect(yaml).toContain("herowcode-api-blue")
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
})
