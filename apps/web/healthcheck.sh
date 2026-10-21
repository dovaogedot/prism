#!/bin/sh
# Exits 0 when the storefront answers, over whichever scheme WEB_TLS chose.
# The certificate is self-signed, so this checks the answer, not the chain.
if [ "${WEB_TLS:-self-signed}" = "off" ]; then
  exec wget -q --spider http://127.0.0.1:3000/
fi
exec wget -q --spider --no-check-certificate https://127.0.0.1:3000/
