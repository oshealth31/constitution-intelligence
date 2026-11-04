# CI ONLY (Deployment check): a throwaway SFTP server standing in for the off-site backup
# location (Task D7). Two accounts:
#   copier  the nightly copy job: may add and read files, NOT delete them (sftp -P remove,rmdir)
#   keeper  the pruning job: may delete
# Keys come from /etc/ssh/keys/<user> (mounted by the workflow). Never used on a real server.
FROM debian:bookworm-slim
RUN apt-get update \
 && apt-get install -y --no-install-recommends openssh-server \
 && rm -rf /var/lib/apt/lists/* \
 && mkdir -p /run/sshd \
 && groupadd offsite \
 && useradd -m -g offsite -s /usr/sbin/nologin copier \
 && useradd -m -g offsite -s /usr/sbin/nologin keeper \
 && mkdir -p /data/backups \
 && chown copier:offsite /data/backups && chmod 2775 /data/backups
COPY sshd_config /etc/ssh/sshd_config
CMD ["/bin/sh", "-c", "ssh-keygen -A >/dev/null && exec /usr/sbin/sshd -D -e"]
