FROM caddy:2.11.4-alpine@sha256:6aeddd44c3078b0f9a35206472a11420648a79c184603ef95957d0a20044cb2b
COPY frontend/dist/mentor/browser/ /srv/
COPY frontend/dist/mentor/3rdpartylicenses.txt /srv/3rdpartylicenses.txt
COPY frontend/licenses/ /opt/mentor/licenses/
COPY infra/proxy/Caddyfile /etc/caddy/Caddyfile
EXPOSE 80 443
