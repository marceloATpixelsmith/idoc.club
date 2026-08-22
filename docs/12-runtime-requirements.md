# Runtime Requirements

This document records the supported application runtime for development, continuous integration, verification, and production deployment.

## Node.js

IDOC requires Node.js 24.x.

The root `package.json` is authoritative for the supported Node.js major version. Local development, GitHub Actions verification, Vercel builds, and any other Node.js execution environment must use Node.js 24.x so that the runtime being tested matches the runtime being deployed.

Do not validate releases on Node.js 20 or Node.js 22 while production is configured for Node.js 24. When the supported Node.js major version changes, update the root `package.json`, all CI workflow pins, deployment configuration, and this document in the same pull request.

## Package manager

Use the repository's committed pnpm configuration and frozen lockfile for reproducible installs in CI and release verification.
