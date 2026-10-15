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

# Rebuild the same standard Caddy release with the fixed Go/x/net versions (INF-19).
# Dependency selection is committed; ordinary builds never run go get/tidy or fetch another toolchain.
FROM golang:1.26.9-alpine@sha256:3082400e369fa24d5fc60bca20edab3f6d604e0c5a690ec66b295eff4dd87ade AS caddy_build
WORKDIR /build
ENV GOTOOLCHAIN=local CGO_ENABLED=0
COPY infra/caddy/go.mod infra/caddy/go.sum ./
RUN --mount=type=cache,target=/go/pkg/mod go mod download && go mod verify
COPY infra/caddy/main.go ./
RUN --mount=type=cache,target=/go/pkg/mod --mount=type=cache,target=/root/.cache/go-build \
    go build -mod=readonly -trimpath -tags nobadger,nomysql,nopgx -ldflags="-s -w" -o /out/caddy . \
    && go version -m /out/caddy \
    && cp /go/pkg/mod/github.com/caddyserver/caddy/v2@v2.11.7/LICENSE /out/LICENSE.caddy

FROM caddy:2.11.7-alpine@sha256:d8542f48d34a9cf4e4c11a478865229840e87e4c96ea3f439101f31a5d35f75f
COPY --from=caddy_build /out/caddy /usr/bin/caddy
# COPY replaces the inode on which the official image installed this capability.
RUN setcap cap_net_bind_service=+ep /usr/bin/caddy
COPY --from=caddy_build /out/LICENSE.caddy /opt/mentor/licenses/LICENSE.caddy
COPY --from=dist /out/mentor/browser/ /srv/
COPY --from=dist /out/mentor/3rdpartylicenses.txt /srv/3rdpartylicenses.txt
COPY frontend/licenses/ /opt/mentor/licenses/
COPY infra/proxy/Caddyfile /etc/caddy/Caddyfile
EXPOSE 80 443
