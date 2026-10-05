# syntax=docker/dockerfile:1

# ---- Build stage: compile the static site ----
# Pinned to the exact patch/Alpine tag resolved by inspecting node:22-alpine at
# the time this file was written (v22.23.3 on Alpine 3.24.2), not the floating
# major tag - a rebuild weeks from now gets the same image, not whatever "22"
# has moved on to.
FROM node:22.23.3-alpine3.24 AS build
WORKDIR /app

# Install dependencies first so this layer is cached until package files change.
COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build

# ---- Runtime stage: nginx serving the static files, non-root, port 8080 ----
# Same tag letter-duel uses - still resolves (confirmed by pulling it), so kept
# matching rather than pinned further.
FROM nginxinc/nginx-unprivileged:1.30-alpine

COPY nginx/nginx.conf /etc/nginx/nginx.conf
COPY nginx/security-headers.conf /etc/nginx/security-headers.conf
# The base image ships its own default index.html and 50x.html in this
# directory, owned by root; clear them first (as root, then switch back to
# the image's own non-root user) so the image contains only dist/, nothing
# left over from the base image's stock placeholder page.
USER root
RUN rm -rf /usr/share/nginx/html/*
USER nginx
COPY --from=build /app/dist /usr/share/nginx/html

# Cloud Run expects the container to listen on 8080; the base image's own user
# (101, non-root) already owns the paths nginx needs to write to.
EXPOSE 8080

# No HEALTHCHECK: Cloud Run ignores it (does its own HTTP probing), and
# keeping the image free of a wget/curl-driven healthcheck loop is one fewer
# thing running inside the container. /healthz exists in nginx.conf for a
# human or an external uptime check to hit directly.

CMD ["nginx", "-g", "daemon off;"]
