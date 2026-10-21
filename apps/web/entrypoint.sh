#!/bin/sh
# Starts Caddy. WEB_TLS chooses how the storefront is served:
#
#   self-signed  HTTPS on port 3000 with a certificate for localhost that this
#                script makes on the first start, and again when it nears its
#                end, in /tls. The default, for every stack on a laptop.
#   off          plain HTTP on port 3000, for a server whose own proxy
#                terminates TLS with a real certificate in front of it.
set -eu

: "${WEB_TLS:=self-signed}"

case "$WEB_TLS" in
  self-signed)
    # -checkend: true while the certificate is still valid a day from now.
    if [ ! -s /tls/key.pem ] || ! openssl x509 -checkend 86400 -noout -in /tls/cert.pem >/dev/null 2>&1; then
      umask 077
      openssl req -x509 -newkey ec -pkeyopt ec_paramgen_curve:prime256v1 -nodes -days 825 \
        -subj "/CN=localhost" \
        -addext "subjectAltName=DNS:localhost,IP:127.0.0.1" \
        -keyout /tls/key.pem -out /tls/cert.pem 2>/dev/null
      echo "Made a self-signed certificate for localhost, valid for 825 days."
    fi
    ;;
  off) ;;
  *)
    echo "WEB_TLS must be self-signed or off, not '$WEB_TLS'." >&2
    exit 1
    ;;
esac

export WEB_TLS
exec caddy run --config /etc/caddy/Caddyfile --adapter caddyfile
