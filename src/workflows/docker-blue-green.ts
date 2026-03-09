export type TDockerTeam = "FRONT" | "BACK" | "API" | "BOT" | "OTHER"
export type TDockerEnvironment = "production" | "staging" | "development"

export interface IDockerBlueGreenParams {
  appName: string
  dockerNetwork: string
  containerPort: string
  vpsPort: string
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
    dockerNetwork,
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

  const volumeFlag = volumeMount ? `\n              -v ${volumeMount} \\` : ""

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

  const healthCheckBlock = healthEndpoint
    ? `
            HEALTHY=false
            CONTAINER_IP=$(docker inspect -f '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' ${appName}-green)
            for i in $(seq 1 20); do
              if curl -sf "http://\${CONTAINER_IP}:${containerPort}${healthEndpoint}" > /dev/null 2>&1; then
                HEALTHY=true
                break
              fi
              echo "Waiting... attempt $i/20"
              sleep 5
            done

            if [ "$HEALTHY" = "false" ]; then
              echo "Health check failed, rolling back"
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
      - uses: actions/checkout@v4

      - name: Log in to GHCR
        uses: docker/login-action@v3
        with:
          registry: ghcr.io
          username: \${{ github.actor }}
          password: \${{ secrets.GITHUB_TOKEN }}

      - name: Extract metadata
        id: meta
        uses: docker/metadata-action@v5
        with:
          images: ghcr.io/\${{ github.repository_owner }}/${appName}
          tags: |
            type=semver,pattern={{version}}
            type=sha

      - name: Build and push
        uses: docker/build-push-action@v5
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
            docker network inspect ${dockerNetwork} > /dev/null 2>&1 || docker network create ${dockerNetwork}

            echo "$GITHUB_TOKEN" | docker login ghcr.io -u \${{ github.actor }} --password-stdin

            docker pull $IMAGE

            docker run -d \\
              --name ${appName}-green \\
              --network ${dockerNetwork} \\
              --env-file ${envFilePath} \\
              --label app=${appName} \\
              --label environment=${environment} \\
              --label team=${team}${volumeFlag} \\
              $IMAGE
${healthCheckBlock}
            docker rm -f ${appName} 2>/dev/null || true
            docker run -d \\
              --name ${appName} \\
              --network ${dockerNetwork} \\
              --env-file ${envFilePath} \\
              -p 127.0.0.1:${vpsPort}:${containerPort} \\
              --label app=${appName} \\
              --label environment=${environment} \\
              --label team=${team}${volumeFlag} \\
              $IMAGE

            docker rm -f ${appName}-green
            docker image prune -f
            docker images --format '{{.Repository}}:{{.Tag}} {{.ID}}' | grep ghcr.io/\${{ github.repository_owner }}/${appName} | grep -v $(docker inspect --format '{{.Image}}' ${appName} | cut -d: -f2 | head -c12) | awk '{print $2}' | xargs -r docker rmi || true
            docker logout ghcr.io
            echo "Deployment successful"
`
}
