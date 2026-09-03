# Tassl

Tassl is an AI decision simulator for higher education: students run realistic decision scenarios with an AI assistant, and faculty review the judgment trace.

Quick start: `cp .env.example .env`, start Postgres (`docker compose up -d --wait`, or `bash scripts/pg-local.sh start` without Docker), then `pnpm install && pnpm db:migrate && pnpm dev`.

Technical documentation: [docs/tech/00-README.md](docs/tech/00-README.md).
