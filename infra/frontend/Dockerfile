# syntax=docker/dockerfile:1
# DIST_SOURCE=build (default): `npm ci && npm run build` inside the pinned Node 24 image (frontend/package.json
# requires >=24.15.0 <25). DIST_SOURCE=prebuilt: copy frontend/dist/mentor produced on the host by
# `npm.cmd --prefix frontend run build` (the established release procedure). The runtime stage is identical.
ARG DIST_SOURCE=build

FROM node:24.15.0-bookworm-slim@sha256:4e6b70dd6cbfc88c8157ba19aa3d9f9cce6ba4703576d55459e45efcbc9c5f5d AS build
WORKDIR /workspace/frontend
ENV CI=true NG_CLI_ANALYTICS=false
COPY frontend/package.json frontend/package-lock.json ./
COPY frontend/tools/api/package.json tools/api/
RUN --mount=type=cache,target=/root/.npm npm ci --no-audit --no-fund
# schema.d.ts is committed; the build does not regenerate it (CI checks that it matches contracts/openapi.yaml).
COPY frontend/ ./
RUN npm run build && mkdir -p /out && mv dist/mentor /out/mentor

FROM scratch AS prebuilt
COPY frontend/dist/mentor/ /out/mentor/

FROM ${DIST_SOURCE} AS dist

FROM caddy:2.11.4-alpine@sha256:6aeddd44c3078b0f9a35206472a11420648a79c184603ef95957d0a20044cb2b
COPY --from=dist /out/mentor/browser/ /srv/
COPY --from=dist /out/mentor/3rdpartylicenses.txt /srv/3rdpartylicenses.txt
COPY frontend/licenses/ /opt/mentor/licenses/
COPY infra/proxy/Caddyfile /etc/caddy/Caddyfile
EXPOSE 80 443
