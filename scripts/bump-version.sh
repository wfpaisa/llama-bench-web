#!/usr/bin/env bash
# Bump de versión patch en cada commit (vía husky pre-commit).
#
#   1. Bump patch de package.json (bun pm version --no-git-tag-version)
#   2. Regenera front/src/version.ts desde package.json (gen:version)
#   3. Stagea ambos archivos para incluirlos en el commit en curso
#
# A diferencia del antiguo release.sh (pre-push), NO builda el AppImage:
# el build se hace a mano con `bun run dist` cuando se quiera empaquetar.
# Tampoco hace `git commit`, así el hook pre-commit no se dispara recursivamente.
set -euo pipefail

cd "$(git rev-parse --show-toplevel)"

# ── 1) Bump patch de package.json ──────────────────────────────────────────
# --no-git-tag-version: solo edita package.json (sin commit/tag automáticos).
# Bun imprime la nueva versión a stdout en formato "vX.Y.Z".
NEW_VERSION=$(bun pm version patch --no-git-tag-version | tr -d 'v')

# ── 2) Regenera version.ts desde package.json ──────────────────────────────
bun run --cwd front gen:version >/dev/null

# ── 3) Stagea ambos para que entren en el commit en curso ──────────────────
git add package.json front/src/version.ts
