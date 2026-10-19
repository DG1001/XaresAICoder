# squid 6.13 (Ubuntu 24.04 base); no version tag matches this build, so pinned by digest
FROM ubuntu/squid:latest@sha256:6a097f68bae708cedbabd6188d68c7e2e7a38cedd05a176e1cc0ba29e3bbe029

USER root

# Install required packages
RUN apt-get update && apt-get install -y \
    openssl \
    curl \
    ssl-cert \
    && rm -rf /var/lib/apt/lists/*

# Create directories for SSL certificates and database
RUN mkdir -p /etc/squid/certs /var/lib/squid/ssl_db && \
    chown -R proxy:proxy /etc/squid/certs /var/lib/squid/ssl_db

# Copy Squid configuration (the whitelist itself lives on a volume, seeded
# from the default by xares-entrypoint.sh)
COPY squid.conf /etc/squid/squid.conf
COPY whitelist-default.conf /etc/squid/whitelist-default.conf

# Create log directory
RUN mkdir -p /var/log/squid && \
    chown -R proxy:proxy /var/log/squid

# Expose ports
EXPOSE 3128 3130

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
    CMD curl -f http://localhost:3128/ || exit 1

# Sets the workspace subnet ACL from SECURITY_NETWORK_SUBNET, then hands over
# to the base image's entrypoint.sh. Overriding ENTRYPOINT resets the base
# image's CMD, so it is repeated here.
COPY xares-entrypoint.sh /usr/local/bin/xares-entrypoint.sh
ENTRYPOINT ["/usr/local/bin/xares-entrypoint.sh"]
CMD ["-f", "/etc/squid/squid.conf", "-NYC"]
