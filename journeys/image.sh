#!/usr/bin/env bash
# Build the runner image from dist/ (run build.ts first) and load it into the kind cluster.
set -euo pipefail
cd "$(dirname "$0")"

TAG=$(node -p 'require("./dist/catalog.json").image.tag')
IMAGE="btb-runner:$TAG"

docker build --build-arg "TAG=$TAG" -t "$IMAGE" .
if command -v kind >/dev/null && kind get clusters | grep -qx btb; then
  kind load docker-image "$IMAGE" --name btb
fi
echo "$IMAGE"
