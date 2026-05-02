import type { ICacheMount } from "../detect"

export type TDockerTeam = "FRONT" | "BACK" | "API" | "BOT" | "OTHER"
export type TDockerEnvironment = "production" | "staging" | "development"
export type TAppType =
  | "spa"
  | "nextjs"
  | "node-api"
  | "python"
  | "static"
  | "other"

export interface IDockerBlueGreenParams {
  appName: string
  dockerNetworks: string[]
  containerPort?: string
  vpsPort?: string
  envFilePath: string
  team: TDockerTeam
  environment: TDockerEnvironment
  vpsUser?: string
  volumeMount?: string
  infraServices?: string
  healthEndpoint?: string
  cacheMounts?: ICacheMount[]
  useTraefik?: boolean
  traefikDomain?: string
  traefikEntrypoint?: string
  traefikCertResolver?: string
  traefikMiddlewares?: string[]
  appType?: TAppType
}

interface ITraefikExtraRouter {
  suffix: string
  pathRule: string
  middlewares: string[]
}

interface IAppTypePresets {
  rootMiddlewares: string[]
  extraRouters: ITraefikExtraRouter[]
}

const HASHED_ASSETS_REGEX = "\\\\.(js|css|woff2?|map)\\$"
const MEDIA_REGEX = "\\\\.(png|jpe?g|gif|svg|webp|avif|ico|mp4|webm|mp3)\\$"

export function getAppTypePresets(type: TAppType): IAppTypePresets {
  if (type === "spa") {
    return {
      rootMiddlewares: ["compress", "sec-headers", "cc-no-store"],
      extraRouters: [
        {
          suffix: "assets",
          pathRule: `PathRegexp(\`${HASHED_ASSETS_REGEX}\`)`,
          middlewares: ["compress", "sec-headers", "cc-immutable"],
        },
        {
          suffix: "media",
          pathRule: `PathRegexp(\`${MEDIA_REGEX}\`)`,
          middlewares: ["compress", "sec-headers", "cc-media"],
        },
      ],
    }
  }
  if (type === "nextjs") {
    return {
      rootMiddlewares: ["compress", "sec-headers"],
      extraRouters: [
        {
          suffix: "next-static",
          pathRule: "PathPrefix(`/_next/static`)",
          middlewares: ["compress", "sec-headers", "cc-immutable"],
        },
        {
          suffix: "next-image",
          pathRule: "PathPrefix(`/_next/image`)",
          middlewares: ["compress", "sec-headers", "cc-next-image"],
        },
        {
          suffix: "media",
          pathRule: `PathRegexp(\`${MEDIA_REGEX}\`)`,
          middlewares: ["compress", "sec-headers", "cc-media"],
        },
      ],
    }
  }
  if (type === "node-api") {
    return {
      rootMiddlewares: [
        "compress",
        "sec-headers",
        "api-ratelimit",
        "cc-no-store",
      ],
      extraRouters: [],
    }
  }
  if (type === "python") {
    return {
      rootMiddlewares: ["compress", "sec-headers", "body-150m"],
      extraRouters: [
        {
          suffix: "static",
          pathRule: "PathPrefix(`/static`)",
          middlewares: ["compress", "sec-headers", "cc-media"],
        },
        {
          suffix: "media",
          pathRule: "PathPrefix(`/media`)",
          middlewares: ["compress", "sec-headers", "cc-public"],
        },
      ],
    }
  }
  if (type === "static") {
    return {
      rootMiddlewares: ["compress", "sec-headers", "cc-public"],
      extraRouters: [
        {
          suffix: "assets",
          pathRule: `PathRegexp(\`${HASHED_ASSETS_REGEX}\`)`,
          middlewares: ["compress", "sec-headers", "cc-immutable"],
        },
        {
          suffix: "media",
          pathRule: `PathRegexp(\`${MEDIA_REGEX}\`)`,
          middlewares: ["compress", "sec-headers", "cc-media"],
        },
      ],
    }
  }
  return { rootMiddlewares: [], extraRouters: [] }
}

export function generateDockerBlueGreen(
  params: IDockerBlueGreenParams,
): string {
  const {
    appName,
    dockerNetworks,
    containerPort,
    vpsPort,
    envFilePath,
    team,
    environment,
    vpsUser = "deploy",
    volumeMount,
    infraServices,
    healthEndpoint = "/health",
    cacheMounts = [],
    useTraefik = false,
    traefikDomain,
    traefikEntrypoint = "websecure",
    traefikCertResolver = "le",
    traefikMiddlewares,
    appType = "other",
  } = params

  const presets = getAppTypePresets(appType)
  const rootMiddlewares = traefikMiddlewares ?? presets.rootMiddlewares
  const extraRouters = presets.extraRouters

  const normalizedNetworks = dockerNetworks
    .map((network) => network.trim())
    .filter(Boolean)

  if (normalizedNetworks.length === 0) {
    throw new Error("At least one Docker network is required")
  }

  if (useTraefik && !traefikDomain?.trim()) {
    throw new Error("traefikDomain is required when useTraefik is true")
  }

  const primaryNetwork = normalizedNetworks[0]
  const additionalNetworks = normalizedNetworks.slice(1)
  const normalizedContainerPort = containerPort?.trim()
  const normalizedVpsPort = vpsPort?.trim()
  const hasPublishedPort = Boolean(normalizedContainerPort && normalizedVpsPort)
  const networkEnsureBlock = normalizedNetworks
    .map(
      (network) =>
        `            docker network inspect ${network} > /dev/null 2>&1 || docker network create ${network}`,
    )
    .join("\n")
  const connectGreenNetworksBlock = additionalNetworks
    .map(
      (network) =>
        `            docker network connect ${network} ${appName}-green`,
    )
    .join("\n")
  const connectFinalNetworksBlock = additionalNetworks
    .map(
      (network) => `            docker network connect ${network} ${appName}`,
    )
    .join("\n")

  const cacheMountSteps = cacheMounts
    .map(
      (mount) => `      - name: Cache ${mount.id}
        id: cache-${mount.id}
        uses: actions/cache@v4
        with:
          path: ${mount.id}
          key: ${mount.id}-\${{ hashFiles('${mount.lockfile}') }}
          restore-keys: |
            ${mount.id}-

      - name: Inject ${mount.id} into buildx
        uses: reproducible-containers/buildkit-cache-dance@v3.1.2
        with:
          cache-map: |
            {
              "${mount.id}": "${mount.path}"
            }
          skip-extraction: \${{ steps.cache-${mount.id}.outputs.cache-hit }}
`,
    )
    .join("\n")
  const cacheMountsBlock = cacheMountSteps ? `\n${cacheMountSteps}` : ""
  const cacheMountsComment =
    cacheMounts.length > 0
      ? `      # Deps caches persisted across runs via buildkit-cache-dance.
      # For this to speed up builds, your Dockerfile must use BuildKit cache mounts, e.g.:
${cacheMounts
  .map(
    (mount) =>
      `      #   RUN --mount=type=cache,target=${mount.path} <install command>`,
  )
  .join("\n")}
`
      : ""

  const indent = "            "
  const joinDockerRunLines = (lines: string[]): string =>
    lines
      .map((line, i) => `${line}${i < lines.length - 1 ? " \\" : ""}`)
      .join("\n")

  const greenRunLines = [
    `${indent}docker run -d`,
    `${indent}  --name ${appName}-green`,
    `${indent}  --network ${primaryNetwork}`,
    `${indent}  --env-file ${envFilePath}`,
    `${indent}  --label app=${appName}`,
    `${indent}  --label environment=${environment}`,
    `${indent}  --label team=${team}`,
    ...(volumeMount ? [`${indent}  -v ${volumeMount}`] : []),
    `${indent}  $IMAGE`,
  ]
  const greenRunBlock = joinDockerRunLines(greenRunLines)

  const dockerHealthLines =
    healthEndpoint && normalizedContainerPort
      ? [
          `${indent}  --health-cmd "curl -sf http://127.0.0.1:${normalizedContainerPort}${healthEndpoint} || exit 1"`,
          `${indent}  --health-interval=30s`,
          `${indent}  --health-timeout=5s`,
          `${indent}  --health-start-period=20s`,
          `${indent}  --health-retries=3`,
        ]
      : []

  const escapeForLabel = (rule: string): string => rule.replace(/`/g, "\\`")
  const buildRouterLines = (
    routerName: string,
    rule: string,
    middlewares: string[],
    declareService: boolean,
  ): string[] => [
    `${indent}  --label "traefik.http.routers.${routerName}.rule=${escapeForLabel(rule)}"`,
    `${indent}  --label traefik.http.routers.${routerName}.entrypoints=${traefikEntrypoint}`,
    `${indent}  --label traefik.http.routers.${routerName}.tls=true`,
    `${indent}  --label traefik.http.routers.${routerName}.tls.certresolver=${traefikCertResolver}`,
    ...(declareService
      ? [
          `${indent}  --label traefik.http.routers.${routerName}.service=${appName}`,
        ]
      : []),
    ...(middlewares.length > 0
      ? [
          `${indent}  --label traefik.http.routers.${routerName}.middlewares=${middlewares.join(",")}`,
        ]
      : []),
  ]

  const hostRule = `Host(\`${traefikDomain?.trim()}\`)`
  const traefikLabelLines = useTraefik
    ? [
        `${indent}  --label traefik.enable=true`,
        `${indent}  --label "traefik.docker.network=${primaryNetwork}"`,
        ...(normalizedContainerPort
          ? [
              `${indent}  --label traefik.http.services.${appName}.loadbalancer.server.port=${normalizedContainerPort}`,
            ]
          : []),
        ...buildRouterLines(appName, hostRule, rootMiddlewares, false),
        ...extraRouters.flatMap((router) =>
          buildRouterLines(
            `${appName}-${router.suffix}`,
            `${hostRule} && ${router.pathRule}`,
            router.middlewares,
            true,
          ),
        ),
      ]
    : []

  const finalRunLines = [
    `${indent}docker run -d`,
    `${indent}  --name ${appName}`,
    `${indent}  --restart unless-stopped`,
    `${indent}  --network ${primaryNetwork}`,
    `${indent}  --env-file ${envFilePath}`,
    ...(hasPublishedPort
      ? [
          `${indent}  -p 127.0.0.1:${normalizedVpsPort}:${normalizedContainerPort}`,
        ]
      : []),
    ...dockerHealthLines,
    `${indent}  --label app=${appName}`,
    `${indent}  --label environment=${environment}`,
    `${indent}  --label team=${team}`,
    ...traefikLabelLines,
    ...(volumeMount ? [`${indent}  -v ${volumeMount}`] : []),
    `${indent}  $IMAGE`,
  ]
  const finalRunBlock = joinDockerRunLines(finalRunLines)

  const dockerHealthComment =
    dockerHealthLines.length > 0
      ? `\n            # Docker health check requires \`curl\` in the image. If your base
            # image does not include it, add: RUN apt-get update && apt-get install -y curl
            # (or the equivalent for alpine/distroless). Without it, --health-cmd fails
            # and the daemon will keep restarting the container.`
      : ""

  const infraCheckBlock = infraServices
    ? `
            # Wait for infrastructure services to be healthy (or running, when no
            # healthcheck is defined). Aborts the deploy if a dep is missing or
            # never becomes ready.
            for service in ${infraServices}; do
              ready=false
              for i in $(seq 1 30); do
                state=$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$service" 2>/dev/null || echo missing)
                case "$state" in
                  healthy|running)
                    ready=true
                    break
                    ;;
                  missing)
                    echo "Service $service not found, aborting deploy"
                    exit 1
                    ;;
                esac
                echo "Waiting for $service ($state)... attempt $i/30"
                sleep 5
              done
              if [ "$ready" = "false" ]; then
                echo "Service $service never became ready, aborting deploy"
                exit 1
              fi
            done
`
    : ""

  const healthCheckBlock =
    healthEndpoint && normalizedContainerPort
      ? `
            HEALTHY=false
            CONTAINER_IP=$(docker inspect -f '{{range .NetworkSettings.Networks}}{{if .IPAddress}}{{.IPAddress}}{{"\\n"}}{{end}}{{end}}' ${appName}-green | awk 'NF { print; exit }')
            for i in $(seq 1 20); do
              if curl -sf "http://\${CONTAINER_IP}:${normalizedContainerPort}${healthEndpoint}" > /dev/null 2>&1; then
                HEALTHY=true
                break
              fi
              echo "Waiting... attempt $i/20"
              sleep 5
            done

            if [ "$HEALTHY" = "false" ]; then
              echo "Health check failed, rolling back"
              echo "Container logs (last 50 lines):"
              docker logs --tail 50 ${appName}-green || echo "Unable to fetch logs from ${appName}-green"
              docker rm -f ${appName}-green
              exit 1
            fi
`
      : `
            HEALTHY=false
            for i in $(seq 1 20); do
              if docker ps --filter "name=${appName}-green" --filter "status=running" -q | grep -q .; then
                HEALTHY=true
                break
              fi
              echo "Waiting for container... attempt $i/20"
              sleep 5
            done

            if [ "$HEALTHY" = "false" ]; then
              echo "Container health check failed (container not running), rolling back"
              echo "Container logs (last 50 lines):"
              docker logs --tail 50 ${appName}-green || echo "Unable to fetch logs from ${appName}-green"
              docker rm -f ${appName}-green
              exit 1
            fi
`

  return `name: Deploy ${appName}

on:
  push:
    tags:
      - 'v*'
  workflow_dispatch:

permissions:
  contents: read
  packages: write
  actions: write

jobs:
  build-and-push:
    runs-on: ubuntu-latest
    outputs:
      image: \${{ steps.meta.outputs.tags }}
    steps:
      - uses: actions/checkout@v6

      - name: Set up Docker Buildx
        uses: docker/setup-buildx-action@v4

      - name: Log in to GHCR
        uses: docker/login-action@v4
        with:
          registry: ghcr.io
          username: \${{ github.actor }}
          password: \${{ secrets.GITHUB_TOKEN }}

      - name: Extract metadata
        id: meta
        uses: docker/metadata-action@v6
        with:
          images: ghcr.io/\${{ github.repository_owner }}/${appName}
          tags: |
            type=semver,pattern={{version}}
            type=sha
${cacheMountsBlock}
${cacheMountsComment}      - name: Build and push
        uses: docker/build-push-action@v7
        with:
          context: .
          push: true
          tags: \${{ steps.meta.outputs.tags }}
          labels: \${{ steps.meta.outputs.labels }}
          cache-from: type=gha
          cache-to: type=gha,mode=max

  deploy:
    runs-on: ubuntu-latest
    needs: build-and-push
    steps:
      - name: Deploy via SSH
        uses: appleboy/ssh-action@v1
        env:
          GITHUB_TOKEN: \${{ secrets.GITHUB_TOKEN }}
        with:
          host: \${{ secrets.VPS_HOST }}
          username: ${vpsUser}
          key: \${{ secrets.VPS_SSH_KEY }}
          envs: GITHUB_TOKEN
          script: |
            IMAGE=$(echo "\${{ needs.build-and-push.outputs.image }}" | head -n1)
${infraCheckBlock}
${networkEnsureBlock}

            echo "$GITHUB_TOKEN" | docker login ghcr.io -u \${{ github.actor }} --password-stdin

            docker pull $IMAGE

${greenRunBlock}
${connectGreenNetworksBlock ? `${connectGreenNetworksBlock}\n` : ""}
${healthCheckBlock}
            docker rm -f ${appName} 2>/dev/null || true${dockerHealthComment}
${finalRunBlock}
${connectFinalNetworksBlock ? `${connectFinalNetworksBlock}\n` : ""}

            docker rm -f ${appName}-green
            docker image prune -f
            docker images --format '{{.Repository}}:{{.Tag}} {{.ID}}' | grep ghcr.io/\${{ github.repository_owner }}/${appName} | grep -v $(docker inspect --format '{{.Image}}' ${appName} | cut -d: -f2 | head -c12) | awk '{print $2}' | xargs -r docker rmi || true
            docker logout ghcr.io
            echo "Deployment successful"
`
}
