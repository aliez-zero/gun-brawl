# syntax=docker/dockerfile:1.7

# ---- web ----
FROM node:22-bookworm-slim AS web
WORKDIR /app
RUN corepack enable
COPY web/package.json web/pnpm-lock.yaml web/pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile
COPY web/ ./
# `tsc` covers tests/ and vite.config.ts, which import `../server/ai`.
# Without this copy the image build dies with TS2307 even though CI type-checks clean.
COPY server/ai /server/ai
RUN pnpm build

# ---- rust ----
FROM rust:1-bookworm AS chef
RUN cargo install cargo-chef --locked
WORKDIR /src

FROM chef AS planner
COPY server/ .
RUN cargo chef prepare --recipe-path recipe.json

FROM chef AS build
COPY --from=planner /src/recipe.json .
RUN cargo chef cook --release --recipe-path recipe.json
COPY server/ .
RUN cargo build --release --bin gunbrawl-server

# ---- runtime ----
FROM debian:bookworm-slim AS runtime
RUN useradd -r -u 10001 app && mkdir -p /data && chown app /data
COPY --from=build /src/target/release/gunbrawl-server /usr/local/bin/
COPY --from=web /app/dist /srv/web
USER app
ENV GUNBRAWL_WEB_DIR=/srv/web \
    GUNBRAWL_DB=/data/gunbrawl.db \
    RUST_LOG=info
EXPOSE 8080
HEALTHCHECK --interval=15s --timeout=3s --start-period=10s \
  CMD ["/usr/local/bin/gunbrawl-server", "--health"]
ENTRYPOINT ["/usr/local/bin/gunbrawl-server"]
