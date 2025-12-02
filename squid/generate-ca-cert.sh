#!/bin/bash
#
# Generate SSL CA Certificate for Squid HTTPS Interception
# This certificate is used by Squid to decrypt and inspect HTTPS traffic
#

set -e

CERT_DIR="./squid/certs"
CA_CERT="$CERT_DIR/squid-ca-cert.pem"
CA_KEY="$CERT_DIR/squid-ca-key.pem"
CA_CRT="$CERT_DIR/squid-ca-cert.crt"

# Create directory if not exists
mkdir -p "$CERT_DIR"

# Check if certificate already exists
if [ -f "$CA_CERT" ] && [ -f "$CA_KEY" ]; then
    echo "SSL CA certificate already exists at $CA_CERT"
    echo "Delete it first if you want to regenerate."
    exit 0
fi

echo "Generating SSL CA certificate for Squid HTTPS interception..."

# Generate private key
openssl genrsa -out "$CA_KEY" 4096

# Generate self-signed certificate (valid for 10 years)
openssl req -new -x509 -days 3650 -key "$CA_KEY" -out "$CA_CERT" \
    -subj "/C=US/ST=State/L=City/O=XaresAICoder/OU=Squid Proxy/CN=XaresAICoder Squid CA"

# Create .crt version for easier distribution (same as .pem)
cp "$CA_CERT" "$CA_CRT"

echo ""
echo "✓ SSL CA certificate generated successfully!"
echo ""
echo "Certificate files:"
echo "  - CA Certificate + Key: $CA_CERT (for Squid)"
echo "  - CA Private Key: $CA_KEY (for Squid)"
echo "  - CA Certificate (CRT): $CA_CRT (for workspace trust)"
echo ""
echo "This certificate will be:"
echo "  1. Used by Squid to decrypt HTTPS traffic"
echo "  2. Trusted in workspace containers (added during build)"
echo "  3. Valid for 10 years"
echo ""
echo "IMPORTANT: Keep $CA_KEY secure - it allows decryption of all HTTPS traffic!"
echo ""
