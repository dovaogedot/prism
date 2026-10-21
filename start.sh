#!/usr/bin/env bash
#
# The entire prerequisite list for this project is Docker.
#
#   ./start.sh          build, run and seed everything
#   ./start.sh --pull   also refresh base images
#   ./start.sh down     stop and remove the stack
#   ./start.sh reset    stop and delete the volumes too
#   ./start.sh seed     run only the seed
#   ./start.sh test     run every test suite in a container
#   ./start.sh test npm run test:unit     run that command there instead
#   ./start.sh test e2e run the browser suite against a stack of its own
#   ./start.sh loadtest baseline|normal|peak|stress   run one load run
#   ./start.sh loadtest down   remove the load test's stack

set -euo pipefail
cd "$(dirname "$0")"

readonly WEB_PORT_DEFAULT=3000
readonly RABBITMQ_UI_PORT_DEFAULT=15672

# The browser suite's stack: a project of its own, never the one above, with
# the stripe service kept down whatever .env says.
e2e_compose() {
  COMPOSE_PROFILES= docker compose -p prism-e2e -f docker-compose.yml -f docker-compose.e2e.yml "$@"
}

# Builds and seeds the prism-e2e stack, runs the suite against it with any
# arguments passed on to `playwright test`, and removes that project with its
# volumes, whatever the suite found.
run_e2e() {
  local status=0

  e2e_compose up --build --detach || status=$?
  if [ "$status" -eq 0 ]; then
    e2e_compose run --rm --build seed || status=$?
  fi
  if [ "$status" -eq 0 ]; then
    e2e_compose run --rm --build e2e npx playwright test "$@" || status=$?
  fi

  e2e_compose down --volumes --remove-orphans
  return "$status"
}

# The load test's stack: a project of its own too. k6 runs as this user, so
# the results it writes stay this user's.
load_compose() {
  COMPOSE_PROFILES= LOAD_UID="$(id -u)" LOAD_GID="$(id -g)" \
    docker compose -p prism-load -f docker-compose.yml -f docker-compose.loadtest.yml "$@"
}

# Postgres's costliest statements since the run began, as CSV.
readonly COSTLIEST_STATEMENTS="SELECT calls, round(total_exec_time) AS total_ms, round(mean_exec_time::numeric, 2) AS mean_ms,
  left(regexp_replace(query, '\s+', ' ', 'g'), 160) AS query
  FROM pg_stat_statements WHERE dbid = (SELECT oid FROM pg_database WHERE datname = 'prism')
  ORDER BY total_exec_time DESC LIMIT 10"

# Runs one load run against the prism-load stack, which it starts and seeds
# first, while the stats service samples every container every few seconds.
# Leaves the k6 summary, the samples, the costliest statements and the
# report's tables in loadtest/results. The stack stays up for the next run.
run_load() {
  local run="${1:-}"
  local status=0
  local samples=()

  case "$run" in
    down)
      load_compose down --volumes --remove-orphans
      return 0
      ;;
    baseline | normal | peak | stress) ;;
    *)
      echo "Usage: ./start.sh loadtest baseline|normal|peak|stress|down" >&2
      return 2
      ;;
  esac

  mkdir -p loadtest/results
  load_compose up --build --detach
  # The seed plants into an empty catalog only, so a stack seeded before is left as it is.
  load_compose run --rm --build seed
  # Plenty of stock first, so the run's own checkouts never sell out what a
  # later step adds to a cart, and a sold-out product never counts as a failure.
  load_compose exec -T postgres psql -U prism -d prism -q -c "UPDATE product SET stock = 1000000" \
    -c "CREATE EXTENSION IF NOT EXISTS pg_stat_statements" -c "SELECT pg_stat_statements_reset()" >/dev/null

  # The stress run keeps every sample, so the report can read it step by step.
  if [ "$run" = "stress" ]; then
    samples=(--out "csv=/loadtest/results/stress-samples.csv")
  fi

  load_compose up --detach stats
  load_compose run --rm k6 run ${samples[@]+"${samples[@]}"} "/loadtest/runs/$run.ts" || status=$?
  load_compose logs --no-log-prefix stats >"loadtest/results/stats-$run.csv"
  load_compose rm --stop --force stats >/dev/null

  load_compose exec -T postgres psql -U prism -d prism --csv -c "$COSTLIEST_STATEMENTS" >"loadtest/results/queries-$run.csv"
  docker run --rm --user "$(id -u):$(id -g)" -v "$PWD/loadtest:/loadtest" node:26-slim node /loadtest/report.ts "$run" || status=$?
  return "$status"
}

ensure_env_file() {
  [ -f .env ] && return 0

  echo "No .env found, so copying .env.example."
  cp .env.example .env
}

case "${1:-up}" in
  down)
    docker compose down
    exit 0
    ;;
  reset)
    docker compose down --volumes
    echo "Stack and volumes removed."
    exit 0
    ;;
esac

ensure_env_file

# After the .env step: compose checks the whole file, where the api requires
# JWT_SECRET, even when it runs only the test service.
case "${1:-up}" in
  seed)
    exec docker compose run --rm --build seed
    ;;
  loadtest)
    run_load "${@:2}"
    exit $?
    ;;
  test)
    if [ "${2:-}" = "e2e" ]; then
      run_e2e "${@:3}"
      exit $?
    fi
    exec docker compose run --rm --build test "${@:2}"
    ;;
esac

# `depends_on: service_completed_successfully` makes this fail by itself if the
# migration exits non-zero, so its status is the whole check.
# (`docker compose wait migrate` cannot be used here: by the time up returns,
# the one-shot container has already exited and wait no longer sees it.)
if ! docker compose up --build --detach "$@"; then
  echo >&2
  echo "The stack did not come up. Migration logs:" >&2
  docker compose logs migrate >&2
  exit 1
fi

admin_email="$(grep -E '^ADMIN_EMAIL=' .env | cut -d= -f2-)"
if [ -n "$admin_email" ]; then
  admin="    Admin           ${admin_email} / ADMIN_PASSWORD, with a code from ADMIN_TOTP_SECRET in an authenticator app"
else
  admin="    Admin           none: set ADMIN_EMAIL, ADMIN_PASSWORD and ADMIN_TOTP_SECRET in .env (see .env.example)"
fi

web_port="$(grep -E '^WEB_PORT=' .env | cut -d= -f2)"
web_port="${web_port:-$WEB_PORT_DEFAULT}"
rabbit_port="$(grep -E '^RABBITMQ_UI_PORT=' .env | cut -d= -f2)"
rabbit_port="${rabbit_port:-$RABBITMQ_UI_PORT_DEFAULT}"

if [ -n "$(grep -E '^STRIPE_SECRET_KEY=' .env | cut -d= -f2)" ]; then
  payments="Stripe test mode"
else
  payments="off until STRIPE_SECRET_KEY and STRIPE_PUBLISHABLE_KEY are in .env"
fi

# The storefront's certificate is self-signed, so -k: this asks whether it
# answers, not whether the browser will trust it.
echo
printf 'Waiting for the storefront'
for _ in $(seq 1 60); do
  if curl -kfsS -o /dev/null "https://localhost:${web_port}/api/v1/health" 2>/dev/null; then
    printf '\n'
    break
  fi
  printf '.'
  sleep 1
done

# The shop already answers. The seed stands apart from it, so a failed seed
# leaves an empty shop running instead of failing the start.
echo "Seeding the shop."
shopper="    Seeded shopper  shopper@prism.test / correct horse battery staple"
if ! docker compose run --rm --build seed; then
  echo "The seed failed, so the shop is empty. ./start.sh seed runs it again." >&2
  shopper=""
fi

cat <<BANNER

  Prism is up.

    Storefront      https://localhost:${web_port}   (self-signed certificate: accept the warning once)
    Inbox (Mailpit) http://localhost:8025    prism / MAILPIT_PASSWORD
    RabbitMQ UI     http://localhost:${rabbit_port}   prism / RABBITMQ_PASSWORD
    Payments        ${payments}

${shopper}
${admin}

  Logs   docker compose logs -f
  Stop   ./start.sh down

BANNER

# Links in emails and the OAuth redirects are built from PUBLIC_WEB_URL, and
# the storefront answers https only.
if grep -qE '^PUBLIC_WEB_URL=http://' .env; then
  echo "  Note: PUBLIC_WEB_URL in .env starts with http://. Change it to https://localhost:${web_port}"
  echo "  and run ./start.sh again, or the links in emails and the OAuth sign-ins will not work."
  echo
fi
