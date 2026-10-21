# start.sh for Windows. Run it through start.cmd, which works whatever the
# machine's PowerShell script policy is.
#
# The entire prerequisite list for this project is Docker.
#
#   .\start.cmd          build, run and seed everything
#   .\start.cmd --pull   also refresh base images
#   .\start.cmd down     stop and remove the stack
#   .\start.cmd reset    stop and delete the volumes too
#   .\start.cmd seed     run only the seed
#   .\start.cmd test     run every test suite in a container
#   .\start.cmd test npm run test:unit     run that command there instead
#   .\start.cmd test e2e run the browser suite against a stack of its own
#   .\start.cmd loadtest baseline|normal|peak|stress   run one load run
#   .\start.cmd loadtest down   remove the load test's stack

$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

$WebPortDefault = "3000"
$RabbitPortDefault = "15672"
$EnvFile = Join-Path $PSScriptRoot ".env"

# The browser suite's stack: a project of its own, never the one above. A
# profile no service has keeps the stripe service down whatever .env says;
# Windows cannot hold an empty environment variable to override it with.
function Invoke-E2eCompose {
  $env:COMPOSE_PROFILES = "e2e-stack"
  try {
    docker compose -p prism-e2e -f docker-compose.yml -f docker-compose.e2e.yml @args
  }
  finally {
    Remove-Item Env:COMPOSE_PROFILES -ErrorAction SilentlyContinue
  }
}

# The load test's stack: a project of its own too, kept from the stripe
# service the same way.
function Invoke-LoadCompose {
  $env:COMPOSE_PROFILES = "load-stack"
  try {
    docker compose -p prism-load -f docker-compose.yml -f docker-compose.loadtest.yml @args
  }
  finally {
    Remove-Item Env:COMPOSE_PROFILES -ErrorAction SilentlyContinue
  }
}

# Postgres's costliest statements since the run began, as CSV.
$CostliestStatements = @"
SELECT calls, round(total_exec_time) AS total_ms, round(mean_exec_time::numeric, 2) AS mean_ms,
  left(regexp_replace(query, '\s+', ' ', 'g'), 160) AS query
  FROM pg_stat_statements WHERE dbid = (SELECT oid FROM pg_database WHERE datname = 'prism')
  ORDER BY total_exec_time DESC LIMIT 10
"@

function Initialize-EnvFile {
  if (Test-Path $EnvFile) { return }

  Write-Host "No .env found, so copying .env.example."
  Copy-Item (Join-Path $PSScriptRoot ".env.example") $EnvFile
}

$action = if ($args.Count -gt 0) { $args[0] } else { "up" }

if ($action -eq "down") {
  docker compose down
  exit $LASTEXITCODE
}

if ($action -eq "reset") {
  docker compose down --volumes
  if ($LASTEXITCODE -eq 0) { Write-Host "Stack and volumes removed." }
  exit $LASTEXITCODE
}

Initialize-EnvFile

# After the .env step: compose checks the whole file, where the api requires
# JWT_SECRET, even when it runs only the test service.
if ($action -eq "seed") {
  docker compose run --rm --build seed
  exit $LASTEXITCODE
}

# Runs one load run against the prism-load stack, which it starts and seeds
# first, while the stats service samples every container every few seconds.
# Leaves the k6 summary, the samples, the costliest statements and the
# report's tables in loadtest\results. The stack stays up for the next run.
if ($action -eq "loadtest") {
  $run = if ($args.Count -gt 1) { $args[1] } else { "" }

  if ($run -eq "down") {
    Invoke-LoadCompose down --volumes --remove-orphans
    exit $LASTEXITCODE
  }
  if (@("baseline", "normal", "peak", "stress") -notcontains $run) {
    Write-Host "Usage: .\start.cmd loadtest baseline|normal|peak|stress|down"
    exit 2
  }

  $status = 0
  New-Item -ItemType Directory -Force (Join-Path $PSScriptRoot "loadtest\results") | Out-Null
  Invoke-LoadCompose up --build --detach
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
  # The seed plants into an empty catalog only, so a stack seeded before is left as it is.
  Invoke-LoadCompose run --rm --build seed
  # Plenty of stock first, so the run's own checkouts never sell out what a
  # later step adds to a cart, and a sold-out product never counts as a failure.
  Invoke-LoadCompose exec -T postgres psql -U prism -d prism -q -c "UPDATE product SET stock = 1000000" -c "CREATE EXTENSION IF NOT EXISTS pg_stat_statements" -c "SELECT pg_stat_statements_reset()" | Out-Null

  # The stress run keeps every sample, so the report can read it step by step.
  $samples = if ($run -eq "stress") { @("--out", "csv=/loadtest/results/stress-samples.csv") } else { @() }

  Invoke-LoadCompose up --detach stats
  Invoke-LoadCompose run --rm k6 run @samples "/loadtest/runs/$run.ts"
  if ($LASTEXITCODE -ne 0) { $status = $LASTEXITCODE }
  Invoke-LoadCompose logs --no-log-prefix stats | Set-Content -Encoding utf8 (Join-Path $PSScriptRoot "loadtest\results\stats-$run.csv")
  Invoke-LoadCompose rm --stop --force stats | Out-Null

  Invoke-LoadCompose exec -T postgres psql -U prism -d prism --csv -c $CostliestStatements | Set-Content -Encoding utf8 (Join-Path $PSScriptRoot "loadtest\results\queries-$run.csv")
  docker run --rm -v "$(Join-Path $PSScriptRoot 'loadtest'):/loadtest" node:26-slim node /loadtest/report.ts $run
  if ($LASTEXITCODE -ne 0) { $status = $LASTEXITCODE }
  exit $status
}

# Builds and seeds the prism-e2e stack, runs the suite against it with any
# further arguments passed on to `playwright test`, and removes that project
# with its volumes, whatever the suite found.
if ($action -eq "test" -and $args.Count -gt 1 -and $args[1] -eq "e2e") {
  $rest = @($args | Select-Object -Skip 2)
  $status = 0

  Invoke-E2eCompose up --build --detach
  if ($LASTEXITCODE -ne 0) { $status = $LASTEXITCODE }
  if ($status -eq 0) {
    Invoke-E2eCompose run --rm --build seed
    if ($LASTEXITCODE -ne 0) { $status = $LASTEXITCODE }
  }
  if ($status -eq 0) {
    Invoke-E2eCompose run --rm --build e2e npx playwright test @rest
    if ($LASTEXITCODE -ne 0) { $status = $LASTEXITCODE }
  }

  Invoke-E2eCompose down --volumes --remove-orphans
  exit $status
}

if ($action -eq "test") {
  $rest = @($args | Select-Object -Skip 1)
  docker compose run --rm --build test @rest
  exit $LASTEXITCODE
}

# `depends_on: service_completed_successfully` makes this fail by itself if the
# migration exits non-zero, so its status is the whole check.
docker compose up --build --detach @args
if ($LASTEXITCODE -ne 0) {
  Write-Host ""
  Write-Host "The stack did not come up. Migration logs:"
  docker compose logs migrate
  exit 1
}

$adminEmail = (Get-Content $EnvFile | Where-Object { $_ -like "ADMIN_EMAIL=*" } | Select-Object -First 1) -replace "^ADMIN_EMAIL=", ""
$admin = if ($adminEmail) {
  "    Admin           $adminEmail / ADMIN_PASSWORD, with a code from ADMIN_TOTP_SECRET in an authenticator app"
} else {
  "    Admin           none: set ADMIN_EMAIL, ADMIN_PASSWORD and ADMIN_TOTP_SECRET in .env (see .env.example)"
}

$webPort = (Get-Content $EnvFile | Where-Object { $_ -like "WEB_PORT=*" } | Select-Object -First 1) -replace "^WEB_PORT=", ""
if (-not $webPort) { $webPort = $WebPortDefault }
$rabbitPort = (Get-Content $EnvFile | Where-Object { $_ -like "RABBITMQ_UI_PORT=*" } | Select-Object -First 1) -replace "^RABBITMQ_UI_PORT=", ""
if (-not $rabbitPort) { $rabbitPort = $RabbitPortDefault }

$stripeKey = (Get-Content $EnvFile | Where-Object { $_ -like "STRIPE_SECRET_KEY=*" } | Select-Object -First 1) -replace "^STRIPE_SECRET_KEY=", ""
$payments = if ($stripeKey) { "Stripe test mode" } else { "off until STRIPE_SECRET_KEY and STRIPE_PUBLISHABLE_KEY are in .env" }

Write-Host ""
Write-Host -NoNewline "Waiting for the storefront"
foreach ($attempt in 1..60) {
  # curl.exe, not the `curl` alias: it is silent on failure and only sets an exit code.
  # -k: the certificate is self-signed, and this asks only whether the storefront answers.
  curl.exe -kfs -o NUL "https://localhost:$webPort/api/v1/health"
  if ($LASTEXITCODE -eq 0) { break }
  Write-Host -NoNewline "."
  Start-Sleep -Seconds 1
}

# The shop already answers. The seed stands apart from it, so a failed seed
# leaves an empty shop running instead of failing the start.
Write-Host ""
Write-Host "Seeding the shop."
$shopper = "    Seeded shopper  shopper@prism.test / correct horse battery staple"
docker compose run --rm --build seed
if ($LASTEXITCODE -ne 0) {
  Write-Host "The seed failed, so the shop is empty. .\start.cmd seed runs it again."
  $shopper = ""
}

Write-Host @"


  Prism is up.

    Storefront      https://localhost:$webPort   (self-signed certificate: accept the warning once)
    Inbox (Mailpit) http://localhost:8025    prism / MAILPIT_PASSWORD
    RabbitMQ UI     http://localhost:$rabbitPort   prism / RABBITMQ_PASSWORD
    Payments        $payments

$shopper
$admin

  Logs   docker compose logs -f
  Stop   .\start.cmd down

"@

# Links in emails and the OAuth redirects are built from PUBLIC_WEB_URL, and
# the storefront answers https only.
if (Get-Content $EnvFile | Where-Object { $_ -like "PUBLIC_WEB_URL=http://*" }) {
  Write-Host "  Note: PUBLIC_WEB_URL in .env starts with http://. Change it to https://localhost:$webPort"
  Write-Host "  and run .\start.cmd again, or the links in emails and the OAuth sign-ins will not work."
  Write-Host ""
}
