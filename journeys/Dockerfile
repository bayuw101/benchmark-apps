# Runner image: pinned k6 with Chromium (k6 browser, PRD D4) + the bundled journeys. Build with `pnpm --filter @btb/journeys image`.
FROM grafana/k6:2.3.0-with-browser

ARG TAG=dev
LABEL org.opencontainers.image.title="btb-runner" \
      org.opencontainers.image.version="${TAG}"

# Pods get a 64 MB /dev/shm; Chromium uses /tmp instead.
ENV K6_BROWSER_ARGS=no-sandbox,disable-dev-shm-usage

COPY --chown=k6:k6 dist/main.js /home/k6/btb/main.js
COPY --chown=k6:k6 dist/catalog.json /home/k6/btb/catalog.json
