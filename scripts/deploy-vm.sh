#!/usr/bin/env bash
# Build the fork's backend + frontend images for linux/amd64, stream them to
# the VM and restart the excalidash compose stack there.
#
#   scripts/deploy-vm.sh              # build, ship, deploy
#   scripts/deploy-vm.sh --dry-run    # print what would happen
#   scripts/deploy-vm.sh --skip-build # ship/deploy images already built locally
#   scripts/deploy-vm.sh --prune      # also remove old fork images on the VM
#
# Env overrides: DEPLOY_HOST, DEPLOY_DIR, KEEP_IMAGES
set -euo pipefail

HOST="${DEPLOY_HOST:-nop@finnomena-vm}"
REMOTE_DIR="${DEPLOY_DIR:-~/finnomena-selfhosted-apps/excalidash}"
KEEP_IMAGES="${KEEP_IMAGES:-2}"
PLATFORM="linux/amd64"
BACKEND_IMG="excalidash-fork-backend"
FRONTEND_IMG="excalidash-fork-frontend"

DRY_RUN=0 SKIP_BUILD=0 PRUNE=0
for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY_RUN=1 ;;
    --skip-build) SKIP_BUILD=1 ;;
    --prune) PRUNE=1 ;;
    -h|--help) sed -n '2,11p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "unknown option: $arg" >&2; exit 2 ;;
  esac
done

cd "$(dirname "$0")/.."

run() {
  echo "+ $*"
  [ "$DRY_RUN" = 1 ] || "$@"
}

if [ -n "$(git status --porcelain)" ]; then
  echo "warning: working tree has uncommitted changes; they are included in the build" >&2
  DIRTY="-dirty"
else
  DIRTY=""
fi

VERSION="$(tr -d '[:space:]' < VERSION)"
SHA="$(git rev-parse --short HEAD)"
TAG="${VERSION}-${SHA}${DIRTY}"
LABEL="fork-${SHA}${DIRTY}"
echo "Deploying ${TAG} to ${HOST}:${REMOTE_DIR}"

if [ "$SKIP_BUILD" = 0 ]; then
  run docker build --platform "$PLATFORM" -f backend/Dockerfile \
    --build-arg "APP_BUILD_LABEL=${LABEL}" -t "${BACKEND_IMG}:${TAG}" .
  run docker build --platform "$PLATFORM" -f frontend/Dockerfile \
    --build-arg "VITE_APP_BUILD_LABEL=${LABEL}" -t "${FRONTEND_IMG}:${TAG}" .
fi

echo "+ docker save ... | gzip | ssh ${HOST} 'gunzip | docker load'"
if [ "$DRY_RUN" = 0 ]; then
  docker save "${BACKEND_IMG}:${TAG}" "${FRONTEND_IMG}:${TAG}" \
    | gzip | ssh "$HOST" 'gunzip | docker load'
fi

# Keep a copy of the previous tag so a rollback is one line in .env.
REMOTE_SCRIPT=$(cat <<EOF
set -euo pipefail
cd ${REMOTE_DIR}
prev=\$(grep '^EXCALIDASH_TAG=' .env | cut -d= -f2-)
sed -i "s#^EXCALIDASH_TAG=.*#EXCALIDASH_TAG=${TAG}#" .env
docker compose up -d
echo "previous tag: \$prev (rollback: set EXCALIDASH_TAG=\$prev in .env, docker compose up -d)"
for i in \$(seq 1 24); do
  b=\$(docker inspect -f '{{.State.Health.Status}}' excalidash-backend 2>/dev/null || true)
  f=\$(docker inspect -f '{{.State.Health.Status}}' excalidash-frontend 2>/dev/null || true)
  echo "health: backend=\$b frontend=\$f"
  [ "\$b" = healthy ] && [ "\$f" = healthy ] && exit 0
  sleep 5
done
echo "containers not healthy; recent backend logs:" >&2
docker logs --tail 30 excalidash-backend >&2
exit 1
EOF
)
echo "+ ssh ${HOST} <deploy: set EXCALIDASH_TAG=${TAG}, docker compose up -d, wait for healthy>"
[ "$DRY_RUN" = 1 ] || ssh "$HOST" "bash -s" <<<"$REMOTE_SCRIPT"

if [ "$PRUNE" = 1 ]; then
  # Keep the newest KEEP_IMAGES tags of each fork image (the running one is always among them).
  for img in "$BACKEND_IMG" "$FRONTEND_IMG"; do
    echo "+ ssh ${HOST} prune old ${img} tags (keep ${KEEP_IMAGES})"
    [ "$DRY_RUN" = 1 ] || ssh "$HOST" \
      "docker image ls ${img} --format '{{.Repository}}:{{.Tag}}' | tail -n +$((KEEP_IMAGES + 1)) | xargs -r docker rmi"
  done
fi

[ "$DRY_RUN" = 1 ] || ssh "$HOST" 'df -h / | tail -1'
echo "Done: ${TAG}"
