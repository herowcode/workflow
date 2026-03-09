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
  volumeMount?: string
  infraServices?: string
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
    volumeMount,
    infraServices,
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
        with:
          host: \${{ secrets.VPS_HOST }}
          username: deploy
          key: \${{ secrets.VPS_SSH_KEY }}
          script: |
            IMAGE=$(echo "\${{ needs.build-and-push.outputs.image }}" | head -n1)
${infraCheckBlock}
            docker network inspect ${dockerNetwork} > /dev/null 2>&1 || docker network create ${dockerNetwork}

            docker pull $IMAGE

            docker run -d \\
              --name ${appName}-green \\
              --network ${dockerNetwork} \\
              --env-file ${envFilePath} \\
              -p 127.0.0.1:${vpsPort}:${containerPort} \\
              --label app=${appName} \\
              --label environment=${environment} \\
              --label team=${team}${volumeFlag} \\
              $IMAGE

            HEALTHY=false
            for i in $(seq 1 20); do
              if curl -sf http://localhost:${vpsPort}/health > /dev/null 2>&1; then
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

            docker rm -f ${appName}-blue 2>/dev/null || true
            docker rename ${appName}-green ${appName}-blue
            echo "Deployment successful"
`
}
