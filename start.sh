#!/usr/bin/env bash
#
# The entire prerequisite list for this project is Docker.
#
#   ./start.sh          build and run everything
#   ./start.sh --pull   also refresh base images
#   ./start.sh down     stop and remove the stack
#   ./start.sh reset    stop and delete the volumes too
#   ./start.sh test     run every test suite in a container
#   ./start.sh test npm run test:unit     run that command there instead

set -euo pipefail
cd "$(dirname "$0")"

readonly WEB_PORT_DEFAULT=3000

ensure_env_file() {
  [ -f .env ] && return 0

  echo "No .env found — copying .env.example."
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
  test)
    exec docker compose run --rm --build test "${@:2}"
    ;;
esac

# `depends_on: service_completed_successfully` makes this fail by itself if the
# migration or seed step exits non-zero, so its status is the whole check.
# (`docker compose wait migrate` cannot be used here — by the time up returns,
# the one-shot container has already exited and wait no longer sees it.)
if ! docker compose up --build --detach "$@"; then
  echo >&2
  echo "The stack did not come up. Migration/seed logs:" >&2
  docker compose logs migrate >&2
  exit 1
fi

web_port="$(grep -E '^WEB_PORT=' .env | cut -d= -f2)"
web_port="${web_port:-$WEB_PORT_DEFAULT}"

echo
printf 'Waiting for the storefront'
for _ in $(seq 1 60); do
  if curl -fsS -o /dev/null "http://localhost:${web_port}/api/v1/health" 2>/dev/null; then
    printf '\n'
    break
  fi
  printf '.'
  sleep 1
done

cat <<BANNER

  Prism is up.

    Storefront      http://localhost:${web_port}
    Inbox (Mailpit) http://localhost:8025

  Seeded shopper    shopper@prism.test / correct horse battery staple

  Logs   docker compose logs -f
  Stop   ./start.sh down

BANNER
