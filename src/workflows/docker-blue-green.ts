export type TDockerTeam = "FRONT" | "BACK" | "API" | "BOT" | "OTHER"
export type TDockerEnvironment = "production" | "staging" | "development"

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
  } = params

  const normalizedNetworks = dockerNetworks
    .map((network) => network.trim())
    .filter(Boolean)

  if (normalizedNetworks.length === 0) {
    throw new Error("At least one Docker network is required")
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

  const volumeFlag = volumeMount ? `\n              -v ${volumeMount} \\` : ""
  const portPublishFlag = hasPublishedPort
    ? `\n              -p 127.0.0.1:${normalizedVpsPort}:${normalizedContainerPort} \\`
    : ""

  const infraCheckBlock = infraServices
    ? `
            # Check infrastructure services
            for service in ${infraServices}; do
              if ! docker ps --filter "name=$service" --filter "status=running" -q | grep -q .; then
                echo "Service $service is not running, aborting deploy"
                exit 1
              fi
            done
`
    : ""

  const healthCheckBlock =
    healthEndpoint && normalizedContainerPort
      ? `
            HEALTHY=false
            CONTAINER_IP=$(docker inspect -f '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' ${appName}-green)
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

jobs:
  build-and-push:
    runs-on: ubuntu-latest
    outputs:
      image: \${{ steps.meta.outputs.tags }}
    steps:
      - uses: actions/checkout@v4.3.1

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

      - name: Build and push
        uses: docker/build-push-action@v7
        with:
          context: .
          push: true
          tags: \${{ steps.meta.outputs.tags }}
          labels: \${{ steps.meta.outputs.labels }}

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

            docker run -d \\
              --name ${appName}-green \\
              --network ${primaryNetwork} \\
              --env-file ${envFilePath} \\
              --label app=${appName} \\
              --label environment=${environment} \\
              --label team=${team}${volumeFlag} \\
              $IMAGE
${connectGreenNetworksBlock ? `${connectGreenNetworksBlock}\n` : ""}
${healthCheckBlock}
            docker rm -f ${appName} 2>/dev/null || true
            docker run -d \\
              --name ${appName} \\
              --network ${primaryNetwork} \\
              --env-file ${envFilePath} \\
${portPublishFlag}
              --label app=${appName} \\
              --label environment=${environment} \\
              --label team=${team}${volumeFlag} \\
              $IMAGE
${connectFinalNetworksBlock ? `${connectFinalNetworksBlock}\n` : ""}

            docker rm -f ${appName}-green
            docker image prune -f
            docker images --format '{{.Repository}}:{{.Tag}} {{.ID}}' | grep ghcr.io/\${{ github.repository_owner }}/${appName} | grep -v $(docker inspect --format '{{.Image}}' ${appName} | cut -d: -f2 | head -c12) | awk '{print $2}' | xargs -r docker rmi || true
            docker logout ghcr.io
            echo "Deployment successful"
`
}
