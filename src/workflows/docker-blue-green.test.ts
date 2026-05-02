import { describe, expect, it } from "vitest"
import { generateDockerBlueGreen, getAppTypePresets } from "./docker-blue-green"

const baseParams = {
  appName: "herowcode-api",
  dockerNetworks: ["herowcode"],
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

  it("includes Docker layer caching with GHA backend", () => {
    const yaml = generateDockerBlueGreen(baseParams)
    expect(yaml).toContain("cache-from: type=gha")
    expect(yaml).toContain("cache-to: type=gha,mode=max")
    expect(yaml).toContain("actions: write")
  })

  it("sets up buildx before build step", () => {
    const yaml = generateDockerBlueGreen(baseParams)
    const buildxIdx = yaml.indexOf("docker/setup-buildx-action@v4")
    const buildPushIdx = yaml.indexOf("docker/build-push-action@v7")
    expect(buildxIdx).toBeGreaterThan(-1)
    expect(buildxIdx).toBeLessThan(buildPushIdx)
  })

  it("includes GHCR login step with GITHUB_TOKEN", () => {
    const yaml = generateDockerBlueGreen(baseParams)
    expect(yaml).toContain("docker/login-action@v4")
    expect(yaml).toContain("registry: ghcr.io")
    // biome-ignore lint/suspicious/noTemplateCurlyInString: GHA expression syntax
    expect(yaml).toContain("${{ secrets.GITHUB_TOKEN }}")
    // biome-ignore lint/suspicious/noTemplateCurlyInString: GHA expression syntax
    expect(yaml).not.toContain("${{ secrets.GHCR_TOKEN }}")
  })

  it("includes docker metadata with app name", () => {
    const yaml = generateDockerBlueGreen(baseParams)
    expect(yaml).toContain("herowcode-api")
    expect(yaml).toContain("docker/metadata-action@v6")
  })

  it("includes build and push step", () => {
    const yaml = generateDockerBlueGreen(baseParams)
    expect(yaml).toContain("docker/build-push-action@v7")
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

  it("health check uses container IP with curl (not docker exec)", () => {
    const yaml = generateDockerBlueGreen(baseParams)
    expect(yaml).toContain(
      "CONTAINER_IP=$(docker inspect -f '{{range .NetworkSettings.Networks}}{{if .IPAddress}}{{.IPAddress}}",
    )
    expect(yaml).toContain(
      `{{end}}{{end}}' herowcode-api-green | awk 'NF { print; exit }')`,
    )
    // biome-ignore lint/suspicious/noTemplateCurlyInString: Shell script variable syntax
    expect(yaml).toContain('curl -sf "http://${CONTAINER_IP}:4000/health"')
    expect(yaml).not.toContain("docker exec")
  })

  it("includes health check loop", () => {
    const yaml = generateDockerBlueGreen(baseParams)
    expect(yaml).toContain("HEALTHY=false")
    expect(yaml).toContain("sleep 5")
    expect(yaml).toContain("rolling back")
  })

  it("prints green container logs when curl health check fails", () => {
    const yaml = generateDockerBlueGreen(baseParams)
    expect(yaml).toContain('echo "Container logs (last 50 lines):"')
    expect(yaml).toContain("docker logs --tail 50 herowcode-api-green")
    expect(yaml).toContain(
      'echo "Unable to fetch logs from herowcode-api-green"',
    )
  })

  it("uses custom health endpoint when provided", () => {
    const yaml = generateDockerBlueGreen({
      ...baseParams,
      healthEndpoint: "/api/health",
    })
    // biome-ignore lint/suspicious/noTemplateCurlyInString: Shell script variable syntax
    expect(yaml).toContain('curl -sf "http://${CONTAINER_IP}:4000/api/health"')
  })

  it("uses container status check when healthEndpoint is empty string", () => {
    const yaml = generateDockerBlueGreen({
      ...baseParams,
      healthEndpoint: "",
    })
    expect(yaml).toContain(
      'docker ps --filter "name=herowcode-api-green" --filter "status=running"',
    )
    expect(yaml).toContain("Waiting for container... attempt")
    expect(yaml).toContain(
      "Container health check failed (container not running)",
    )
    expect(yaml).not.toContain("CONTAINER_IP")
    expect(yaml).not.toContain("curl")
  })

  it("prints green container logs when status health check fails", () => {
    const yaml = generateDockerBlueGreen({
      ...baseParams,
      healthEndpoint: "",
    })
    expect(yaml).toContain('echo "Container logs (last 50 lines):"')
    expect(yaml).toContain("docker logs --tail 50 herowcode-api-green")
    expect(yaml).toContain(
      'echo "Unable to fetch logs from herowcode-api-green"',
    )
  })

  it("defaults to /health endpoint when healthEndpoint is not provided", () => {
    const yaml = generateDockerBlueGreen(baseParams)
    // biome-ignore lint/suspicious/noTemplateCurlyInString: Shell script variable syntax
    expect(yaml).toContain('curl -sf "http://${CONTAINER_IP}:4000/health"')
  })

  it("green container does not bind to host port", () => {
    const yaml = generateDockerBlueGreen(baseParams)
    const greenRunIdx = yaml.indexOf("--name herowcode-api-green")
    const portIdx = yaml.indexOf("-p 127.0.0.1:8080:4000")
    // port binding must not appear before the final docker run (after green is removed)
    expect(greenRunIdx).toBeGreaterThan(-1)
    expect(portIdx).toBeGreaterThan(greenRunIdx)
  })

  it("final container uses app name with port binding", () => {
    const yaml = generateDockerBlueGreen(baseParams)
    const portIdx = yaml.indexOf("-p 127.0.0.1:8080:4000")
    const finalNameIdx = yaml.indexOf("--name herowcode-api \\")
    expect(portIdx).toBeGreaterThan(-1)
    expect(finalNameIdx).toBeGreaterThan(-1)
    // final --name herowcode-api block should appear before the port line
    expect(finalNameIdx).toBeLessThan(portIdx)
  })

  it("omits host port binding when app does not expose ports", () => {
    const yaml = generateDockerBlueGreen({
      ...baseParams,
      containerPort: undefined,
      vpsPort: undefined,
      healthEndpoint: "",
    })

    expect(yaml).not.toContain("-p 127.0.0.1:")
  })

  it("falls back to status health check when container port is missing", () => {
    const yaml = generateDockerBlueGreen({
      ...baseParams,
      containerPort: undefined,
      vpsPort: undefined,
    })

    expect(yaml).toContain(
      'docker ps --filter "name=herowcode-api-green" --filter "status=running"',
    )
    expect(yaml).toContain("Waiting for container... attempt")
    expect(yaml).not.toContain("CONTAINER_IP")
    expect(yaml).not.toContain("curl -sf")
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
    // checks for the volume mount indentation pattern inside docker run, not grep/awk flags
    expect(yaml).not.toContain("              -v ")
  })

  it("includes infra service checks when provided", () => {
    const yaml = generateDockerBlueGreen({
      ...baseParams,
      infraServices: "herowcode-postgres herowcode-redis",
    })
    expect(yaml).toContain("herowcode-postgres herowcode-redis")
    expect(yaml).toContain("Service $service not found, aborting deploy")
    expect(yaml).toContain("never became ready, aborting deploy")
    expect(yaml).toContain(
      "{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}",
    )
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

  it("prunes dangling images and old app images after deploy", () => {
    const yaml = generateDockerBlueGreen(baseParams)
    expect(yaml).toContain("docker image prune -f")
    expect(yaml).toContain(
      // biome-ignore lint/suspicious/noTemplateCurlyInString: GHA expression syntax
      "ghcr.io/${{ github.repository_owner }}/herowcode-api",
    )
    expect(yaml).toContain("xargs -r docker rmi")
  })

  it("logs out of GHCR after deployment", () => {
    const yaml = generateDockerBlueGreen(baseParams)
    const logoutIdx = yaml.indexOf("docker logout ghcr.io")
    const successIdx = yaml.indexOf("Deployment successful")
    expect(logoutIdx).toBeGreaterThan(-1)
    expect(logoutIdx).toBeLessThan(successIdx)
  })

  it("creates and connects multiple networks", () => {
    const yaml = generateDockerBlueGreen({
      ...baseParams,
      dockerNetworks: ["herowcode", "shared-services"],
    })

    expect(yaml).toContain(
      "docker network inspect herowcode > /dev/null 2>&1 || docker network create herowcode",
    )
    expect(yaml).toContain(
      "docker network inspect shared-services > /dev/null 2>&1 || docker network create shared-services",
    )
    expect(yaml).toContain("--network herowcode")
    expect(yaml).toContain(
      "docker network connect shared-services herowcode-api-green",
    )
    expect(yaml).toContain(
      "docker network connect shared-services herowcode-api",
    )
  })

  it("omits buildkit-cache-dance steps when no cacheMounts are provided", () => {
    const yaml = generateDockerBlueGreen(baseParams)
    expect(yaml).not.toContain("buildkit-cache-dance")
    expect(yaml).not.toContain("actions/cache@v4")
  })

  it("injects buildkit-cache-dance for a single node cache mount", () => {
    const yaml = generateDockerBlueGreen({
      ...baseParams,
      cacheMounts: [
        { id: "npm-cache", path: "/root/.npm", lockfile: "package-lock.json" },
      ],
    })
    expect(yaml).toContain("actions/cache@v4")
    expect(yaml).toContain("reproducible-containers/buildkit-cache-dance@v3")
    expect(yaml).toContain('"npm-cache": "/root/.npm"')
    expect(yaml).toContain(
      // biome-ignore lint/suspicious/noTemplateCurlyInString: GHA expression syntax
      "key: npm-cache-${{ hashFiles('package-lock.json') }}",
    )
    expect(yaml).toContain(
      "RUN --mount=type=cache,target=/root/.npm <install command>",
    )
    const injectIdx = yaml.indexOf("buildkit-cache-dance")
    const buildIdx = yaml.indexOf("docker/build-push-action@v7")
    expect(injectIdx).toBeGreaterThan(-1)
    expect(injectIdx).toBeLessThan(buildIdx)
  })

  it("emits one step per cache mount for polyglot projects", () => {
    const yaml = generateDockerBlueGreen({
      ...baseParams,
      cacheMounts: [
        {
          id: "pnpm-store",
          path: "/root/.local/share/pnpm/store",
          lockfile: "pnpm-lock.yaml",
        },
        {
          id: "pip-cache",
          path: "/root/.cache/pip",
          lockfile: "requirements.txt",
        },
      ],
    })
    expect(yaml).toContain('"pnpm-store": "/root/.local/share/pnpm/store"')
    expect(yaml).toContain('"pip-cache": "/root/.cache/pip"')
    const cacheSteps = yaml.match(/uses: actions\/cache@v4/g) ?? []
    expect(cacheSteps).toHaveLength(2)
    const danceSteps =
      yaml.match(/reproducible-containers\/buildkit-cache-dance@v3/g) ?? []
    expect(danceSteps).toHaveLength(2)
  })

  it("does not emit Traefik labels when useTraefik is false (default)", () => {
    const yaml = generateDockerBlueGreen(baseParams)
    expect(yaml).not.toContain("traefik.enable=true")
    expect(yaml).not.toContain("traefik.http.routers")
  })

  it("emits Traefik labels on the final container when useTraefik is true", () => {
    const yaml = generateDockerBlueGreen({
      ...baseParams,
      useTraefik: true,
      traefikDomain: "api.example.com",
      traefikMiddlewares: ["compress", "sec-headers"],
    })
    expect(yaml).toContain("--label traefik.enable=true")
    expect(yaml).toContain('--label "traefik.docker.network=herowcode"')
    expect(yaml).toContain(
      '--label "traefik.http.routers.herowcode-api.rule=Host(\\`api.example.com\\`)"',
    )
    expect(yaml).toContain(
      "--label traefik.http.routers.herowcode-api.entrypoints=websecure",
    )
    expect(yaml).toContain(
      "--label traefik.http.routers.herowcode-api.tls.certresolver=le",
    )
    expect(yaml).toContain(
      "--label traefik.http.services.herowcode-api.loadbalancer.server.port=4000",
    )
    expect(yaml).toContain(
      "--label traefik.http.routers.herowcode-api.middlewares=compress,sec-headers",
    )
  })

  it("does not emit Traefik labels on the green container", () => {
    const yaml = generateDockerBlueGreen({
      ...baseParams,
      useTraefik: true,
      traefikDomain: "api.example.com",
    })
    const greenStart = yaml.indexOf("--name herowcode-api-green")
    const greenEnd = yaml.indexOf("$IMAGE", greenStart)
    const greenBlock = yaml.slice(greenStart, greenEnd)
    expect(greenBlock).not.toContain("traefik.enable")
  })

  it("omits middleware label when no middlewares selected", () => {
    const yaml = generateDockerBlueGreen({
      ...baseParams,
      useTraefik: true,
      traefikDomain: "api.example.com",
      traefikMiddlewares: [],
    })
    expect(yaml).toContain("--label traefik.enable=true")
    expect(yaml).not.toContain("middlewares=")
  })

  it("supports custom Traefik entrypoint and certResolver", () => {
    const yaml = generateDockerBlueGreen({
      ...baseParams,
      useTraefik: true,
      traefikDomain: "api.example.com",
      traefikEntrypoint: "websecure-internal",
      traefikCertResolver: "cf-dns",
    })
    expect(yaml).toContain(
      "--label traefik.http.routers.herowcode-api.entrypoints=websecure-internal",
    )
    expect(yaml).toContain(
      "--label traefik.http.routers.herowcode-api.tls.certresolver=cf-dns",
    )
  })

  it("throws when useTraefik is true without a domain", () => {
    expect(() =>
      generateDockerBlueGreen({
        ...baseParams,
        useTraefik: true,
      }),
    ).toThrow("traefikDomain is required when useTraefik is true")
  })

  it("emits Docker --health-cmd when port + healthEndpoint are defined", () => {
    const yaml = generateDockerBlueGreen(baseParams)
    expect(yaml).toContain(
      '--health-cmd "curl -sf http://127.0.0.1:4000/health || exit 1"',
    )
    expect(yaml).toContain("--health-interval=30s")
    expect(yaml).toContain("--health-timeout=5s")
    expect(yaml).toContain("--health-start-period=20s")
    expect(yaml).toContain("--health-retries=3")
  })

  it("does not emit Docker --health-cmd when no healthEndpoint", () => {
    const yaml = generateDockerBlueGreen({
      ...baseParams,
      healthEndpoint: "",
    })
    expect(yaml).not.toContain("--health-cmd")
    expect(yaml).not.toContain("--health-interval")
  })

  it("uses appType presets when traefikMiddlewares is omitted (spa)", () => {
    const yaml = generateDockerBlueGreen({
      ...baseParams,
      useTraefik: true,
      traefikDomain: "app.example.com",
      appType: "spa",
    })
    expect(yaml).toContain(
      "--label traefik.http.routers.herowcode-api.middlewares=compress,sec-headers,cc-no-store",
    )
    expect(yaml).toContain(
      '--label "traefik.http.routers.herowcode-api-assets.rule=',
    )
    expect(yaml).toContain(
      "--label traefik.http.routers.herowcode-api-assets.middlewares=compress,sec-headers,cc-immutable",
    )
    expect(yaml).toContain(
      "--label traefik.http.routers.herowcode-api-assets.service=herowcode-api",
    )
    expect(yaml).toContain(
      "--label traefik.http.routers.herowcode-api-media.middlewares=compress,sec-headers,cc-media",
    )
  })

  it("emits Next.js path-based extra routers when appType=nextjs", () => {
    const yaml = generateDockerBlueGreen({
      ...baseParams,
      useTraefik: true,
      traefikDomain: "next.example.com",
      appType: "nextjs",
    })
    expect(yaml).toContain("herowcode-api-next-static.rule=")
    expect(yaml).toContain("PathPrefix(\\`/_next/static\\`)")
    expect(yaml).toContain(
      "herowcode-api-next-static.middlewares=compress,sec-headers,cc-immutable",
    )
    expect(yaml).toContain("herowcode-api-next-image.rule=")
    expect(yaml).toContain("PathPrefix(\\`/_next/image\\`)")
    expect(yaml).toContain(
      "herowcode-api-next-image.middlewares=compress,sec-headers,cc-next-image",
    )
  })

  it("emits Node API ratelimit + no-store middlewares for appType=node-api", () => {
    const yaml = generateDockerBlueGreen({
      ...baseParams,
      useTraefik: true,
      traefikDomain: "api.example.com",
      appType: "node-api",
    })
    expect(yaml).toContain(
      "herowcode-api.middlewares=compress,sec-headers,api-ratelimit,cc-no-store",
    )
    // node-api has no path-based extras
    expect(yaml).not.toContain("herowcode-api-assets")
    expect(yaml).not.toContain("herowcode-api-media")
  })

  it("emits Python /static + /media path-based routers for appType=python", () => {
    const yaml = generateDockerBlueGreen({
      ...baseParams,
      useTraefik: true,
      traefikDomain: "py.example.com",
      appType: "python",
    })
    expect(yaml).toContain("herowcode-api-static.rule=")
    expect(yaml).toContain("PathPrefix(\\`/static\\`)")
    expect(yaml).toContain(
      "herowcode-api-static.middlewares=compress,sec-headers,cc-media",
    )
    expect(yaml).toContain("herowcode-api-media.rule=")
    expect(yaml).toContain("PathPrefix(\\`/media\\`)")
    expect(yaml).toContain(
      "herowcode-api-media.middlewares=compress,sec-headers,cc-public",
    )
  })

  it("emits static-site presets with cc-public root and immutable hashed assets", () => {
    const yaml = generateDockerBlueGreen({
      ...baseParams,
      useTraefik: true,
      traefikDomain: "site.example.com",
      appType: "static",
    })
    expect(yaml).toContain(
      "herowcode-api.middlewares=compress,sec-headers,cc-public",
    )
    expect(yaml).toContain(
      "herowcode-api-assets.middlewares=compress,sec-headers,cc-immutable",
    )
  })

  it("emits no Traefik extras for appType=other", () => {
    const yaml = generateDockerBlueGreen({
      ...baseParams,
      useTraefik: true,
      traefikDomain: "x.example.com",
      appType: "other",
    })
    expect(yaml).not.toContain("herowcode-api-assets")
    expect(yaml).not.toContain("herowcode-api-media")
    expect(yaml).not.toContain("herowcode-api-next-static")
    // root-router has no middlewares label when none provided/preset
    expect(yaml).not.toContain("herowcode-api.middlewares=")
  })

  it("explicit traefikMiddlewares overrides appType presets on root only", () => {
    const yaml = generateDockerBlueGreen({
      ...baseParams,
      useTraefik: true,
      traefikDomain: "app.example.com",
      appType: "spa",
      traefikMiddlewares: ["compress"],
    })
    // root uses override (followed by line-continuation \, not preset chain)
    expect(yaml).toContain("herowcode-api.middlewares=compress \\")
    expect(yaml).not.toContain(
      "herowcode-api.middlewares=compress,sec-headers,cc-no-store",
    )
    // path-based extras keep their fixed middlewares
    expect(yaml).toContain(
      "herowcode-api-assets.middlewares=compress,sec-headers,cc-immutable",
    )
  })

  it("extra routers declare service= pointing back to the main app", () => {
    const yaml = generateDockerBlueGreen({
      ...baseParams,
      useTraefik: true,
      traefikDomain: "site.example.com",
      appType: "static",
    })
    expect(yaml).toContain(
      "--label traefik.http.routers.herowcode-api-assets.service=herowcode-api",
    )
    expect(yaml).toContain(
      "--label traefik.http.routers.herowcode-api-media.service=herowcode-api",
    )
    // root router does NOT declare service (Traefik infers it)
    expect(yaml).not.toContain(
      "--label traefik.http.routers.herowcode-api.service=",
    )
  })

  it("getAppTypePresets returns correct preset shape", () => {
    expect(getAppTypePresets("node-api").extraRouters).toHaveLength(0)
    expect(getAppTypePresets("nextjs").extraRouters).toHaveLength(3)
    expect(getAppTypePresets("spa").rootMiddlewares).toContain("cc-no-store")
    expect(getAppTypePresets("other").rootMiddlewares).toEqual([])
    expect(getAppTypePresets("other").extraRouters).toEqual([])
  })

  it("infra check uses healthy/running state inspect", () => {
    const yaml = generateDockerBlueGreen({
      ...baseParams,
      infraServices: "postgres redis",
    })
    expect(yaml).toContain(
      "{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}",
    )
    expect(yaml).toContain("healthy|running)")
    expect(yaml).toContain("attempt $i/30")
  })

  it("uses only the first container IP in multi-network health checks", () => {
    const yaml = generateDockerBlueGreen({
      ...baseParams,
      dockerNetworks: ["herowcode", "shared-services"],
    })

    expect(yaml).toContain(
      "CONTAINER_IP=$(docker inspect -f '{{range .NetworkSettings.Networks}}{{if .IPAddress}}{{.IPAddress}}",
    )
    expect(yaml).toContain(
      `{{end}}{{end}}' herowcode-api-green | awk 'NF { print; exit }')`,
    )
  })
})
