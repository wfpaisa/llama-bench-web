#!/usr/bin/env bash
# Release flow al hacer `git push` a main (vía husky pre-push).
#
#   1. Bump patch de la versión en package.json (bun pm version)
#   2. Commit del bump (chore: release vX.Y.Z) con --no-verify
#   3. Build completo del AppImage (bun run dist)
#   4. Limpia release/ dejando solo el último .AppImage
#
# Si el build falla, revierte el commit de versión y aborta el push (exit 1).
# Solo corre en la rama main; en otras ramas es no-op.
set -euo pipefail

cd "$(git rev-parse --show-toplevel)"

# ── Solo en main ──────────────────────────────────────────────────────────
BRANCH=$(git rev-parse --abbrev-ref HEAD)
if [ "$BRANCH" != "main" ]; then
  exit 0
fi

# ── 1) Bump patch de versión en package.json ──────────────────────────────
# --no-git-tag-version: solo edita package.json (sin commit/tag automáticos).
# Bun imprime la nueva versión a stdout en formato "vX.Y.Z".
NEW_VERSION=$(bun pm version patch --no-git-tag-version | tr -d 'v')
echo "→ Version bump: $NEW_VERSION"

# ── 2) Commit del bump (sin disparar pre-commit recursivo) ────────────────
git add package.json
git commit -m "chore: release v$NEW_VERSION" --no-verify

# ── 3) Build completo del AppImage ────────────────────────────────────────
echo "→ Building AppImage (bun run dist)…"
if ! bun run dist; then
  echo "✗ Build falló — revirtiendo commit de versión y abortando push"
  # Deshacer el commit del bump y restaurar package.json a su versión previa.
  # --hard es seguro aquí: el único cambio en el working tree es el bump que
  # este mismo hook acaba de introducir (el push parte de un árbol limpio).
  git reset --hard HEAD~1
  exit 1
fi

# ── 4) Limpiar release/ — dejar solo el último AppImage ───────────────────
echo "→ Limpiando builds pasados en release/…"
rm -rf release/linux-unpacked
rm -f release/*.yml
# Conservar solo el .AppImage recién generado (versión actual); borrar los
# anteriores. Se filtra por nombre con la versión del bump en vez de por mtime,
# que no es fiable cuando varios builds se generan en ráfaga.
for f in release/*.AppImage; do
  [ -e "$f" ] || continue
  case "$f" in
    *"-$NEW_VERSION-"*) ;;            # el actual → se conserva
    *) rm -f "$f" ;;
  esac
done

echo "✓ Done — v$NEW_VERSION listo en release/"
