# @herowcode/workflow

> CLI wizard that generates production-ready GitHub Actions workflows for herowcode projects.

[![npm version](https://img.shields.io/npm/v/@herowcode/workflow)](https://www.npmjs.com/package/@herowcode/workflow)
[![license](https://img.shields.io/npm/l/@herowcode/workflow)](./LICENSE)

---

## Why this exists

The herowcode ecosystem has 12+ projects that all share the same CI/CD patterns: Docker blue-green deployments, CI test runners, and NPM package releases. Before this tool, every project copied and maintained these workflow files independently — leading to drift, bugs, and inconsistencies.

`@herowcode/workflow` is an interactive wizard that asks the right questions and writes a customized, production-ready `.github/workflows/*.yml` directly into your project. One command. No copy-paste. No drift.

---

## Usage

```bash
npx @herowcode/workflow
```

No installation required. Run it from the root of any project.

---

## Wizard flow

```
┌  @herowcode/workflow
│
◆  Which workflow do you want to add?
│  ● Docker blue-green deploy
│  ○ CI test runner
│  ○ NPM package release
└
```

The wizard auto-detects your package manager from lockfiles (`pnpm-lock.yaml`, `yarn.lock`, `bun.lockb`, `package-lock.json`) and asks only the questions relevant to the workflow you selected.

When done, it writes `.github/workflows/<name>.yml` and prints the required GitHub secrets. If you're inside a git repository and have the `gh` CLI available, it checks which secrets are already configured and highlights any that are missing.

---

## Workflows

### Docker blue-green deploy

**File:** `.github/workflows/deploy.yml`

A zero-downtime deployment pipeline using a blue-green container swap on your VPS.

**What it does:**

1. Triggers on `v*` tag pushes
2. Builds your Docker image and pushes to GHCR (GitHub Container Registry)
3. SSHs into your VPS and:
   - Optionally verifies infrastructure services are running (Postgres, RabbitMQ, etc.)
   - Pulls the new image
    - Starts a new `<app>-green` container on the configured network(s), port, and env file
   - Runs a health check loop (20 attempts × 5s)
   - If healthy: removes the old `<app>` and renames green → blue
   - If unhealthy: removes the green container and exits with failure (rollback)

**Questions asked:**

| Question | Example |
|---|---|
| App name | `herowcode-api` |
| Docker network(s), comma-separated | `herowcode` or `herowcode,shared-services` |
| Container port | `4000` |
| Env file path on VPS | `~/api/.env` |
| Volume mount (optional) | `herowcode_api_data:/app/data` |
| Infrastructure services (optional) | `herowcode-postgres herowcode-redis` |

**Required GitHub secrets:**

| Secret | Description |
|---|---|
| `VPS_HOST` | IP or hostname of your VPS |
| `VPS_SSH_KEY` | Private SSH key for the `deploy` user |
| `GHCR_TOKEN` | GitHub token with `write:packages` scope |

---

### CI test runner

**File:** `.github/workflows/ci.yml`

Runs lint and tests on every push or pull request.

**What it does:**

1. Configurable trigger: push to main + PRs, push only, or PRs only
2. Sets up Node.js with dependency caching for your package manager
3. Runs `install` → `lint` → `test:run`

**Questions asked:**

| Question | Default |
|---|---|
| Node.js version | `24` |
| Trigger | push to main + pull requests |

Package manager and install command are auto-detected from your lockfile.

**Required GitHub secrets:** none

---

### NPM package release

**File:** `.github/workflows/release.yml`

Publishes your package to npmjs.com or GitHub Packages on tag push or manual trigger.

**What it does:**

1. Configurable trigger: `v*` tag push or `workflow_dispatch`
2. Sets up Node.js pointing at the chosen registry
3. Runs `install` → `build` → `publish`

**Questions asked:**

| Question | Options |
|---|---|
| Trigger | Tag push (`v*`) / Manual dispatch |
| Registry | npmjs.com (OIDC — no secrets required) / GitHub Packages |

**Required GitHub secrets:**

| Registry | Secret needed |
|---|---|
| npmjs.com | None — uses OIDC Trusted Publishing |
| GitHub Packages | `NODE_AUTH_TOKEN` |

When targeting **npmjs.com**, the generated workflow uses OIDC Trusted Publishing: it upgrades npm to v11+, clears the auth token injected by `actions/setup-node`, and publishes with `--provenance`. No long-lived token required — [configure a Trusted Publisher](https://docs.npmjs.com/trusted-publishers) on npmjs.com to match your repo and workflow file.

---

## Versioning and release pipeline

This package manages its own releases using the same workflow it generates.

### Bump and publish

```bash
# Patch release (1.0.0 → 1.0.1)
pnpm version:patch

# Minor release (1.0.0 → 1.1.0)
pnpm version:minor

# Major release (1.0.0 → 2.0.0)
pnpm version:major
```

Each command runs the full validation chain before tagging:

```
lint → test → build → npm version → git push → git push --tags
```

Pushing the tag triggers `.github/workflows/release.yml`, which publishes to npm automatically using **OIDC Trusted Publishing** — no `NODE_AUTH_TOKEN` secret required.

### OIDC Trusted Publishing

This repository is configured as a [Trusted Publisher](https://docs.npmjs.com/trusted-publishers) on npmjs.com. GitHub Actions authenticates directly via OpenID Connect — no long-lived tokens, no secret rotation.

The workflow uses `--provenance` to generate a signed provenance attestation, making the package verifiable in the npm registry supply chain.

---

## Local development

```bash
# Install dependencies
pnpm install

# Run tests
pnpm test:run

# Lint
pnpm lint

# Build
pnpm build

# Smoke test (requires a real TTY)
node dist/cli.cjs
```

### Project structure

```
src/
├── cli.ts                        Entry point
├── main.ts                       Wizard orchestrator (@clack/prompts)
├── detect.ts                     Lockfile-based package manager detection
├── write.ts                      Writes .github/workflows/*.yml
└── workflows/
    ├── index.ts                  Registry
    ├── docker-blue-green.ts      Generator + tests
    ├── ci-test.ts                Generator + tests
    └── npm-release.ts            Generator + tests
```

Templates are TypeScript functions that accept typed params and return a YAML string — not static template files. This gives full type safety and makes them straightforward to test.

---

## License

MIT
