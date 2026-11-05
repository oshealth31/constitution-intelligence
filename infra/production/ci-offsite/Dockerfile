# CI ONLY (Deployment check): a throwaway SFTP server standing in for the off-site backup
# location (Task D7). Two accounts:
#   copier  the nightly copy job: may add and read files, NOT delete them (sftp -P remove,rmdir)
#   keeper  the pruning job: may delete
# Keys come from /keys-in/<user> (mounted by the workflow) and are copied, root-owned, to
# /etc/ssh/keys at start (sshd refuses key files owned by another account). Accounts are
# unlocked with no password ('*'): only the keys work. Never used on a real server.
FROM debian:bookworm-slim
RUN apt-get update \
 && apt-get install -y --no-install-recommends openssh-server \
 && rm -rf /var/lib/apt/lists/* \
 && mkdir -p /run/sshd \
 && groupadd offsite \
 && useradd -m -g offsite -s /usr/sbin/nologin copier \
 && useradd -m -g offsite -s /usr/sbin/nologin keeper \
 && usermod -p '*' copier && usermod -p '*' keeper \
 && mkdir -p /data/backups /data/audit-seals \
 && chown copier:offsite /data/backups /data/audit-seals && chmod 2775 /data/backups /data/audit-seals
COPY sshd_config /etc/ssh/sshd_config
CMD ["/bin/sh", "-c", "ssh-keygen -A >/dev/null && mkdir -p /etc/ssh/keys && cp /keys-in/* /etc/ssh/keys/ && chown root:root /etc/ssh/keys /etc/ssh/keys/* && chmod 0755 /etc/ssh/keys && chmod 0644 /etc/ssh/keys/* && exec /usr/sbin/sshd -D -e"]
