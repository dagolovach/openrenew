# OpenRenew

Self-hosted contract renewal tracking with optional AI extraction — never miss an auto-renewal again.

[![License: AGPL v3](https://img.shields.io/badge/License-AGPL%20v3-blue.svg)](https://www.gnu.org/licenses/agpl-3.0)

## Why

Companies lose real money to vendor contracts that silently auto-renew — a SaaS subscription nobody uses, a lease with a notice window that closed unnoticed, a services agreement that rolled into another year. OpenRenew stores your contracts on **your own server**, extracts the key dates, and warns you at 60, 30, and 7 days before expiry and before the cancellation-notice deadline closes.

## Quickstart

```bash
git clone https://github.com/dagolovach/openrenew && cd openrenew
cp .env.example .env
# generate the three required secrets and paste them into .env:
#   openssl rand -hex 32   (SESSION_SECRET, EXTRACTION_SERVICE_SECRET, CRON_SECRET)
docker compose up -d
# open http://localhost:3000 → create your admin account
```

That's it — four containers come up (web, python, postgres, cron), migrations run automatically, and `/setup` walks you through creating the first admin user.

## Features

- PDF upload with AI field extraction (forced JSON-schema tool call, not free text)
- Party-name anonymization before any contract text reaches an AI provider
- AI risk analysis with concrete findings (up to 8 per contract)
- Alerts at 60/30/7 days before expiry, plus before the notice-period deadline
- Alert delivery via Slack webhook and/or SMTP email
- Contract version comparison on renewal (field and clause diffs)
- AI-drafted vendor emails (e.g. cancellation notices)
- Manual entry mode — full functionality with no AI key configured
- Multi-user shared workspace (single admin-managed team)
- Dark terminal-style UI

<!-- screenshot: dashboard -->

## Privacy

This is the whole point of running it yourself:

- **Self-hosted** — your contracts, your database, your disk. Nothing leaves your infrastructure except optional calls to Anthropic and your own SMTP server.
- **Anonymized before AI sees it** — party names are detected from the contract's opening lines, you confirm them, and only then is the *full* contract text regex-anonymized (both parties replaced with "Party A" / "Party B") before it's sent for extraction, risk analysis, or comparison.
- **AI is entirely optional** — no `ANTHROPIC_API_KEY`, no outbound AI calls, ever. The app runs as a manual tracker.
- **Zero telemetry** — no analytics, no tracking pixels, no phone-home.

## Architecture

```
                    ┌─────────────┐
                    │   Browser    │
                    └──────┬──────┘
                           │ :3000
                    ┌──────▼──────────┐        ┌──────────────┐
                    │  web (Next.js)   │───────▶│  postgres:16  │
                    │  auth, UI, API   │        └──────────────┘
                    │  orchestration   │
                    └──────┬───────────┘
                           │ :8000 (internal)
                    ┌──────▼───────────┐
                    │ python (FastAPI) │──────▶ Anthropic API (optional)
                    │ PDF + Claude     │
                    └──────┬───────────┘
                           │ read-only
                    ┌──────▼───────────┐
                    │ contracts-data    │◀── written by web, read by python
                    │ (shared volume)   │
                    └───────────────────┘

┌─────────────┐
│    cron      │──── daily curl ───▶ web:/api/cron/send-alerts (+weekly digest)
│  (alpine)    │                     → Slack webhook and/or SMTP
└─────────────┘
```

The `web` container validates input, talks to the `python` service over an internal-only port, and writes results to Postgres. `python` is stateless — it only ever reads PDFs from the shared volume (mounted read-only) and calls the Anthropic API. Auth between the two services is a shared-secret bearer token (`EXTRACTION_SERVICE_SECRET`).

## Configuration

All variables live in `.env.example` — copy it to `.env` and fill it in.

| Variable | Required | Default | Purpose |
|----------|----------|---------|---------|
| `POSTGRES_PASSWORD` | Yes | `change-me` | Postgres password (set your own) |
| `DATABASE_URL` | Yes | — | Postgres connection string used by migrations/local dev |
| `SESSION_SECRET` | Yes | — | JWT signing key for session cookies (`openssl rand -hex 32`) |
| `EXTRACTION_SERVICE_SECRET` | Yes | — | Shared secret between `web` and `python` (`openssl rand -hex 32`) |
| `CRON_SECRET` | Yes | — | Auth token the cron sidecar sends to `web` (`openssl rand -hex 32`) |
| `APP_URL` | Yes | `http://localhost:3000` | Base URL used in email templates and cookie security |
| `ANTHROPIC_API_KEY` | No | unset | Enables AI extraction, analysis, comparison, and drafting |
| `SMTP_HOST` | No | unset | SMTP server for email alerts |
| `SMTP_PORT` | No | `587` | SMTP port |
| `SMTP_USER` | No | unset | SMTP auth username |
| `SMTP_PASS` | No | unset | SMTP auth password |
| `SMTP_FROM` | No | unset | From address for alert emails |
| `ALERT_RECIPIENTS` | No | unset | Comma-separated email addresses to receive alerts |
| `AUTH_DISABLED` | No | `false` | `true` disables login entirely — **localhost proof-of-concept only, never production** |
| `DATA_DIR` | No | `./data/contracts` (`/data/contracts` in Docker) | Where contract PDFs are stored on disk |

The Slack webhook URL is **not** an environment variable — it's configured in-app under Settings, tested on save, and stored in the `app_settings` table.

## Running without AI

Leave `ANTHROPIC_API_KEY` unset and OpenRenew runs as a fully manual contract tracker: upload a PDF (or skip it), fill in the fields yourself, confirm, and alerts are generated exactly the same way. Nothing is ever sent to Anthropic.

## Development

```bash
npm install
# uncomment the postgres ports mapping in docker-compose.yml, then:
docker compose up -d postgres
npm run db:migrate
npm run dev          # localhost:3000
npx jest              # run tests
```

Python service:

```bash
cd python-service
pip install -r requirements.txt
uvicorn main:app --reload --port 8000
pytest tests/
```

## Roadmap

- OIDC/SSO login
- Local-model support via Ollama (no API key required at all)
- Microsoft Teams alert delivery
- CSV import/export
- Per-field extraction confidence

Contributions welcome — open an issue or a PR.

## License

AGPL-3.0. Free to self-host and modify. If you offer OpenRenew as a hosted service to others, you must make your modified source available under the same license.
