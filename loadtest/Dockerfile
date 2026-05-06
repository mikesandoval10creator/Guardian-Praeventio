# Minimal Linux runner for the SOS 1k load test.
# Build & run from repo root:
#   docker build -f loadtest/Dockerfile -t praeventio-loadtest .
#   docker run --rm -v "$PWD:/repo" -w /repo praeventio-loadtest \
#       bash loadtest/run.sh

FROM node:20-bullseye

# Java for the Firebase Firestore emulator.
RUN apt-get update \
 && apt-get install -y --no-install-recommends openjdk-17-jre-headless ca-certificates curl \
 && rm -rf /var/lib/apt/lists/*

# Firebase tools is heavy; install globally and reuse via cache.
RUN npm i -g firebase-tools artillery

WORKDIR /repo

CMD ["bash", "loadtest/run.sh"]
