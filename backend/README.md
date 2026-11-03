# AITU clearance backend

Go HTTP API built with Gin and PostgreSQL 15+. API paths and JSON payloads follow [`docs/backend/openapi.yaml`](../docs/backend/openapi.yaml); business rules are in [`docs/backend/README.md`](../docs/backend/README.md).

## Run locally

Requirements: Go 1.25+, Docker with Compose, and PostgreSQL 15+ (Compose starts a local database).

From the repository root:

```bash
docker compose -f backend/compose.yaml up -d db
cd backend
export DATABASE_URL='postgres://clearance:clearance@localhost:5432/clearance?sslmode=disable'
export ADMIN_LOGIN='admin'
export ADMIN_PASSWORD='set-a-private-password-of-at-least-8-characters'
export COOKIE_SECURE=false
export APP_ORIGIN='http://localhost:5173'
export APP_URL='http://localhost:5173'
go run ./cmd/server
```

The API listens on `http://localhost:8000`; `GET /healthz` reports database readiness. The first run applies the embedded migration, creates the five initial templates, and creates an administrator if one does not exist yet. The administrator password is hashed with Argon2id. Do not reuse the example password.

Start the frontend in another terminal with `cd frontend && npm install && npm run dev`. Its Vite proxy already targets port 8000. For local HTTP, set `COOKIE_SECURE=false`; the default is `true` for HTTPS deployments.

## Environment

| Variable | Default | Purpose |
|---|---|---|
| `DATABASE_URL` | required | PostgreSQL connection string |
| `HTTP_ADDR` | `:8000` | HTTP listen address |
| `ADMIN_LOGIN`, `ADMIN_PASSWORD` | unset | Create the first admin; set both together |
| `COOKIE_SECURE` | `true` | Set session cookie `Secure`; turn off only for local HTTP |
| `APP_ORIGIN` | unset | Allowed browser origin, e.g. `https://clearance.example.edu` |
| `APP_URL` | `APP_ORIGIN` or local frontend URL | Origin used in Telegram close notifications |
| `TRUSTED_PROXIES` | unset | Comma-separated trusted proxy IPs/CIDRs used to identify client IPs for rate limits |
| `TELEGRAM_BOT_USERNAME` | `aitu_clearance_bot` | Bot username used for link URLs |
| `TELEGRAM_BOT_TOKEN` | unset | Enables Telegram messages and bot responses |
| `TELEGRAM_WEBHOOK_SECRET` | unset | Secret token for the Telegram webhook endpoint |

In production, configure HTTPS at the reverse proxy, set `COOKIE_SECURE=true`, define `APP_ORIGIN` and `APP_URL`, set `TRUSTED_PROXIES` to the proxy addresses, and do not expose PostgreSQL publicly. The API adds `Strict-Transport-Security`, `X-Content-Type-Options` and `Referrer-Policy` headers.

### Telegram bot

The link screen creates expiring codes; the bot's webhook consumes Telegram `/start <code>` updates at `POST /api/v1/telegram/webhook`. Configure Telegram's `setWebhook` with this URL and the same `TELEGRAM_WEBHOOK_SECRET`. Notifications are sent asynchronously after the mark transaction commits; failures do not undo marks.

## Tests and build

```bash
cd backend
go test ./...
go vet ./...
go build -o /tmp/clearance-api ./cmd/server
```

Tests cover HTTP security behavior, rate limiting, mark validation, sheet-status calculation, CSV formula protection, and Argon2id password hashing. PostgreSQL-backed end-to-end scenarios require a running database; the repository's Playwright scenarios currently use their own contract-compatible fake API.
