#!/usr/bin/env bash
# Switch the deployment from "plain HTTP on :80" to "HTTPS on a domain".
#
# Usage:  ./deploy/switch-https.sh play.example.com [www.play.example.com]
#
# The optional second argument adds an alias to the same site, which makes Caddy cover
# it in the certificate too; otherwise https://www.<domain>/ fails the TLS handshake.
#
# Caddy obtains a Let's Encrypt certificate as soon as the domain resolves to this
# host and port 80/443 are reachable. Verification uses HTTP-01 or TLS-ALPN-01, so a
# mainland host still needs a valid ICP filing: without it the edge answers port 80
# with a block page and resets TLS on 443, and this script rolls back.
set -euo pipefail
cd "$(dirname "$0")/.."

domain="${1:?usage: switch-https.sh <domain> [www.domain]}"
[[ "$domain" == *.* ]] || { echo "not a domain: $domain" >&2; exit 2; }

site="$domain"
if [[ -n "${2:-}" ]]; then
  [[ "$2" == *.* ]] || { echo "not a domain: $2" >&2; exit 2; }
  # Caddy accepts a comma separated address list in one site block.
  site="$domain, $2"
fi

cp -f .env ".env.bak.$(date +%s)"
sed -i "s|^DOMAIN=.*|DOMAIN=$site|" .env

echo "DOMAIN=$site — restarting caddy (certificate request may take ~30s)"
docker compose up -d caddy

for _ in $(seq 1 60); do
  if curl -fsS --max-time 5 "https://$domain/healthz" >/dev/null 2>&1; then
    echo "ok: https://$domain/ is serving"
    if [[ -n "${2:-}" ]]; then
      if curl -fsS --max-time 5 "https://$2/healthz" >/dev/null 2>&1; then
        echo "ok: https://$2/ is serving too"
      else
        echo "warn: https://$2/ is not answering yet (DNS or ACME still pending)" >&2
      fi
    fi
    echo "note: http://<server-ip>/ now redirects to https, so share the domain instead"
    exit 0
  fi
  sleep 2
done

echo "certificate not ready after 120s — rolling back to HTTP on :80" >&2
docker compose logs --tail=40 caddy >&2 || true
sed -i "s|^DOMAIN=.*|DOMAIN=:80|" .env
docker compose up -d caddy
exit 1
