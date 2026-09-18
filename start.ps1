# start.sh for Windows. Run it through start.cmd, which works whatever the
# machine's PowerShell script policy is.
#
# The entire prerequisite list for this project is Docker.
#
#   .\start.cmd          build and run everything
#   .\start.cmd --pull   also refresh base images
#   .\start.cmd down     stop and remove the stack
#   .\start.cmd reset    stop and delete the volumes too
#   .\start.cmd test     run every test suite in a container
#   .\start.cmd test npm run test:unit     run that command there instead

$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

$WebPortDefault = "3000"
$EnvFile = Join-Path $PSScriptRoot ".env"

function Initialize-EnvFile {
  if (Test-Path $EnvFile) { return }

  Write-Host "No .env found - copying .env.example."
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
if ($action -eq "test") {
  $rest = @($args | Select-Object -Skip 1)
  docker compose run --rm --build test @rest
  exit $LASTEXITCODE
}

# `depends_on: service_completed_successfully` makes this fail by itself if the
# migration or seed step exits non-zero, so its status is the whole check.
docker compose up --build --detach @args
if ($LASTEXITCODE -ne 0) {
  Write-Host ""
  Write-Host "The stack did not come up. Migration/seed logs:"
  docker compose logs migrate
  exit 1
}

$webPort = (Get-Content $EnvFile | Where-Object { $_ -like "WEB_PORT=*" } | Select-Object -First 1) -replace "^WEB_PORT=", ""
if (-not $webPort) { $webPort = $WebPortDefault }

Write-Host ""
Write-Host -NoNewline "Waiting for the storefront"
foreach ($attempt in 1..60) {
  # curl.exe, not the `curl` alias: it is silent on failure and only sets an exit code.
  curl.exe -fs -o NUL "http://localhost:$webPort/api/v1/health"
  if ($LASTEXITCODE -eq 0) { break }
  Write-Host -NoNewline "."
  Start-Sleep -Seconds 1
}

Write-Host @"


  Prism is up.

    Storefront      http://localhost:$webPort
    Inbox (Mailpit) http://localhost:8025

  Seeded shopper    shopper@prism.test / correct horse battery staple

  Logs   docker compose logs -f
  Stop   .\start.cmd down

"@
