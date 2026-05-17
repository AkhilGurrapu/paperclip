#!/usr/bin/env bash
set -euo pipefail

PROJECT_DIR="${PAPERCLIP_PROJECT_DIR:-/Users/aisarva/chakras/investsarva/paperclip}"
PAPERCLIP_HOME="${PAPERCLIP_HOME:-/Users/aisarva/.paperclip}"
PAPERCLIP_INSTANCE_ID="${PAPERCLIP_INSTANCE_ID:-mac-mini}"
PAPERCLIP_PUBLIC_URL="${PAPERCLIP_MAC_MINI_PUBLIC_URL:-https://chakra.investsarva.com}"
PAPERCLIP_ALLOWED_HOSTNAMES="${PAPERCLIP_MAC_MINI_ALLOWED_HOSTNAMES:-chakra.investsarva.com}"
PAPERCLIP_EMBEDDED_POSTGRES_PORT="${PAPERCLIP_MAC_MINI_DB_PORT:-54330}"
PORT="${PAPERCLIP_MAC_MINI_PORT:-3110}"
HOST="${PAPERCLIP_MAC_MINI_HOST:-127.0.0.1}"
PNPM_BIN="${PNPM_BIN:-/opt/homebrew/bin/pnpm}"
TSX_BIN="${TSX_BIN:-${PROJECT_DIR}/cli/node_modules/tsx/dist/cli.mjs}"

MAC_MINI_COMPANY_NAME="${MAC_MINI_COMPANY_NAME:-aisarva-mac-mini}"
MAC_MINI_COMPANY_DESCRIPTION="${MAC_MINI_COMPANY_DESCRIPTION:-Mac Mini operator control plane for Aisarva infrastructure.}"
MAC_MINI_ISSUE_PREFIX="${MAC_MINI_ISSUE_PREFIX:-MMI}"

INSTANCE_ROOT="${PAPERCLIP_HOME}/instances/${PAPERCLIP_INSTANCE_ID}"
CONFIG_FILE="${PAPERCLIP_CONFIG:-${INSTANCE_ROOT}/config.json}"
CONTEXT_FILE="${PAPERCLIP_CONTEXT:-${PAPERCLIP_HOME}/context-${PAPERCLIP_INSTANCE_ID}.json}"
HEALTH_URL="http://127.0.0.1:${PORT}/api/health"

export PAPERCLIP_HOME
export PAPERCLIP_INSTANCE_ID
export PAPERCLIP_CONFIG="$CONFIG_FILE"
export PAPERCLIP_CONTEXT="$CONTEXT_FILE"
export PAPERCLIP_PUBLIC_URL
export PAPERCLIP_ALLOWED_HOSTNAMES
export PAPERCLIP_AUTH_PUBLIC_BASE_URL="$PAPERCLIP_PUBLIC_URL"
export BETTER_AUTH_URL="$PAPERCLIP_PUBLIC_URL"
export BETTER_AUTH_BASE_URL="$PAPERCLIP_PUBLIC_URL"
export PAPERCLIP_EMBEDDED_POSTGRES_PORT
export INSTANCE_ROOT
export PAPERCLIP_DEPLOYMENT_MODE="${PAPERCLIP_DEPLOYMENT_MODE:-authenticated}"
export PAPERCLIP_DEPLOYMENT_EXPOSURE="${PAPERCLIP_DEPLOYMENT_EXPOSURE:-private}"
export PAPERCLIP_AUTH_BASE_URL_MODE="${PAPERCLIP_AUTH_BASE_URL_MODE:-explicit}"
export HOST
export PORT
export NODE_ENV="${NODE_ENV:-development}"
export SERVE_UI="${SERVE_UI:-true}"
export PAPERCLIP_MIGRATION_AUTO_APPLY="${PAPERCLIP_MIGRATION_AUTO_APPLY:-true}"
export PAPERCLIP_MIGRATION_PROMPT="${PAPERCLIP_MIGRATION_PROMPT:-never}"
export MAC_MINI_COMPANY_NAME
export MAC_MINI_COMPANY_DESCRIPTION
export MAC_MINI_ISSUE_PREFIX
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:${PATH:-}"

# The mac-mini instance must use its own embedded Postgres cluster. Keep these
# set-but-empty so legacy repo .env files cannot repopulate them via dotenv.
export DATABASE_URL=""
export DATABASE_MIGRATION_URL=""

if [[ -z "${PAPERCLIP_AGENT_JWT_SECRET:-}" ]]; then
  echo "PAPERCLIP_AGENT_JWT_SECRET is required. Start through: iex paperclip-runtime --env=prod -- scripts/run-mac-mini.sh" >&2
  exit 1
fi

mkdir -p "$INSTANCE_ROOT/data/backups" "$INSTANCE_ROOT/data/storage" "$INSTANCE_ROOT/logs" "$INSTANCE_ROOT/secrets"

if [[ ! -f "$CONFIG_FILE" ]]; then
  now="$(date -u '+%Y-%m-%dT%H:%M:%SZ')"
  cat > "$CONFIG_FILE" <<JSON
{
  "\$meta": {
    "version": 1,
    "updatedAt": "$now",
    "source": "onboard"
  },
  "database": {
    "mode": "embedded-postgres",
    "embeddedPostgresDataDir": "$INSTANCE_ROOT/db",
    "embeddedPostgresPort": $PAPERCLIP_EMBEDDED_POSTGRES_PORT,
    "backup": {
      "enabled": true,
      "intervalMinutes": 60,
      "retentionDays": 30,
      "dir": "$INSTANCE_ROOT/data/backups"
    }
  },
  "logging": {
    "mode": "file",
    "logDir": "$INSTANCE_ROOT/logs"
  },
  "server": {
    "deploymentMode": "authenticated",
    "exposure": "private",
    "host": "$HOST",
    "port": $PORT,
    "allowedHostnames": ["chakra.investsarva.com"],
    "serveUi": true
  },
  "auth": {
    "baseUrlMode": "explicit",
    "publicBaseUrl": "$PAPERCLIP_PUBLIC_URL",
    "disableSignUp": false
  },
  "storage": {
    "provider": "local_disk",
    "localDisk": {
      "baseDir": "$INSTANCE_ROOT/data/storage"
    },
    "s3": {
      "bucket": "paperclip",
      "region": "us-east-1",
      "prefix": "",
      "forcePathStyle": false
    }
  },
  "secrets": {
    "provider": "local_encrypted",
    "strictMode": false,
    "localEncrypted": {
      "keyFilePath": "$INSTANCE_ROOT/secrets/master.key"
    }
  }
}
JSON
  chmod 600 "$CONFIG_FILE"
fi

node -e '
const fs = require("fs");
const file = process.argv[1];
const config = JSON.parse(fs.readFileSync(file, "utf8"));
config.database = {
  ...(config.database || {}),
  mode: "embedded-postgres",
  embeddedPostgresDataDir: process.env.PAPERCLIP_MAC_MINI_DB_DIR || `${process.env.INSTANCE_ROOT}/db`,
  embeddedPostgresPort: Number(process.env.PAPERCLIP_EMBEDDED_POSTGRES_PORT),
};
config.server = {
  ...(config.server || {}),
  deploymentMode: "authenticated",
  exposure: "private",
  host: process.env.HOST,
  port: Number(process.env.PORT),
  allowedHostnames: ["chakra.investsarva.com"],
  serveUi: true,
};
config.auth = {
  ...(config.auth || {}),
  baseUrlMode: "explicit",
  publicBaseUrl: process.env.PAPERCLIP_PUBLIC_URL,
  disableSignUp: false,
};
fs.writeFileSync(file, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
' "$CONFIG_FILE"

config_db="$(
  node -e '
const fs = require("fs");
const config = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
const mode = config.database && config.database.mode;
const port = config.database && config.database.embeddedPostgresPort;
console.log(`${mode || ""}\t${port || ""}`);
' "$CONFIG_FILE"
)"
config_db_mode="${config_db%%$'\t'*}"
config_db_port="${config_db#*$'\t'}"
if [[ "$config_db_mode" != "embedded-postgres" || -z "$config_db_port" ]]; then
  echo "Mac-mini Paperclip must use embedded-postgres in $CONFIG_FILE; found mode=${config_db_mode:-unset}" >&2
  exit 1
fi
DB_URL="postgres://paperclip:paperclip@127.0.0.1:${config_db_port}/paperclip"

cd "$PROJECT_DIR"

if [[ ! -f "$TSX_BIN" ]]; then
  echo "tsx entrypoint not found at $TSX_BIN. Run pnpm install in $PROJECT_DIR." >&2
  exit 1
fi

"$PNPM_BIN" paperclipai run --instance "$PAPERCLIP_INSTANCE_ID" --config "$CONFIG_FILE" &
server_pid="$!"

terminate() {
  if kill -0 "$server_pid" 2>/dev/null; then
    kill "$server_pid" 2>/dev/null || true
    wait "$server_pid" 2>/dev/null || true
  fi
}
trap terminate INT TERM

seeded=0
for _ in $(seq 1 120); do
  if curl -fsS "$HEALTH_URL" >/dev/null 2>&1; then
    DATABASE_URL="$DB_URL" node "$TSX_BIN" scripts/seed-mac-mini-company.ts
    seeded=1
    break
  fi
  if ! kill -0 "$server_pid" 2>/dev/null; then
    wait "$server_pid"
    exit $?
  fi
  sleep 1
done

if [[ "$seeded" != "1" ]]; then
  echo "Paperclip mac-mini instance did not become healthy at $HEALTH_URL before timeout" >&2
fi

wait "$server_pid"
