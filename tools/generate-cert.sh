#!/usr/bin/env bash
# Generates a self-signed TLS certificate for server.js's optional HTTPS
# listener, valid for localhost/127.0.0.1 and every non-internal IPv4
# address this PC currently has (so it covers whichever LAN a phone
# actually reaches it on). Re-run this if the PC's LAN IP changes and a
# phone that already trusted the old certificate stops connecting.
#
# Requires openssl (bundled with Git for Windows / Git Bash already).
set -e
cd "$(dirname "$0")/.."
mkdir -p certs

ADDRS=$(node -e "
const os = require('os');
const out = ['localhost', '127.0.0.1'];
for (const list of Object.values(os.networkInterfaces())) {
  for (const net of list || []) {
    if (net.family === 'IPv4' && !net.internal) out.push(net.address);
  }
}
console.log(out.map((a) => (/^\d/.test(a) ? \`IP:\${a}\` : \`DNS:\${a}\`)).join(','));
")

echo "Generating certificate for: $ADDRS"

MSYS_NO_PATHCONV=1 openssl req -x509 -newkey rsa:2048 \
  -keyout certs/server.key -out certs/server.crt \
  -days 3650 -nodes \
  -subj "/CN=Rig Radar Local" \
  -addext "subjectAltName=$ADDRS"

echo "Done. certs/server.key and certs/server.crt written."
echo "Restart the server to pick them up."
