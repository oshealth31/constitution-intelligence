#!/usr/bin/env bash
# Prepares a fresh Ubuntu 24.04 server (Oracle Cloud, Arm) for Constitution Intelligence (Task S2).
# Run as root, once (running it again is safe). Called by the "Deploy" workflow
# (task: prepare-server); see docs/operations/oracle-cloud.md.
#
# - Docker Engine and the Compose plugin from Docker's own package source
# - automatic security updates
# - SSH: keys only, no root login; fail2ban blocks repeated failed logins
# - firewall: opens 80 and 443 in the server's own firewall (Oracle images block them)
# - /srv/constitution for the application files
set -euo pipefail
export DEBIAN_FRONTEND=noninteractive NEEDRESTART_MODE=a

if [ "$(id -u)" -ne 0 ]; then
  echo "Run as root (sudo)." >&2
  exit 1
fi
. /etc/os-release
if [ "${ID:-}" != ubuntu ]; then
  echo "This script supports Ubuntu only (found: ${ID:-unknown})." >&2
  exit 1
fi

echo "== Packages"
# Do not let the firewall package save the current rules (they may include Docker's).
printf '%s\n' 'iptables-persistent iptables-persistent/autosave_v4 boolean false' \
  'iptables-persistent iptables-persistent/autosave_v6 boolean false' | debconf-set-selections
apt-get update -q
apt-get install -y -q ca-certificates curl gnupg unattended-upgrades fail2ban \
  iptables-persistent openssl zstd

echo "== Docker"
if ! command -v docker >/dev/null || ! docker compose version >/dev/null 2>&1; then
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
  chmod a+r /etc/apt/keyrings/docker.asc
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu ${VERSION_CODENAME} stable" \
    > /etc/apt/sources.list.d/docker.list
  apt-get update -q
  apt-get install -y -q docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
fi
# Keep container logs bounded even for containers without their own settings.
if [ ! -f /etc/docker/daemon.json ]; then
  printf '{\n  "log-driver": "json-file",\n  "log-opts": { "max-size": "20m", "max-file": "5" }\n}\n' \
    > /etc/docker/daemon.json
fi
systemctl enable --now docker
systemctl restart docker
docker version --format 'Docker {{.Server.Version}}'
docker compose version

echo "== Automatic security updates"
cat > /etc/apt/apt.conf.d/20auto-upgrades <<'CONF'
APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Unattended-Upgrade "1";
APT::Periodic::AutocleanInterval "7";
CONF
systemctl enable --now unattended-upgrades

echo "== SSH: keys only"
install -d /etc/ssh/sshd_config.d
cat > /etc/ssh/sshd_config.d/60-constitution.conf <<'CONF'
PasswordAuthentication no
KbdInteractiveAuthentication no
PermitRootLogin no
X11Forwarding no
MaxAuthTries 3
CONF
if command -v sshd > /dev/null; then
  sshd -t
  # Ubuntu 24.04 starts SSH on demand; this reloads it only if it is running.
  systemctl try-reload-or-restart ssh.service
fi
systemctl enable --now fail2ban

echo "== Firewall: allow 80 and 443"
# Oracle's Ubuntu images end the INPUT chain with a REJECT rule. Insert the web ports before it.
for port in 80 443; do
  if ! iptables -C INPUT -p tcp -m state --state NEW --dport "$port" -j ACCEPT 2>/dev/null; then
    reject_line=$(iptables -L INPUT --line-numbers -n | awk '$2 == "REJECT" {print $1; exit}')
    if [ -n "$reject_line" ]; then
      iptables -I INPUT "$reject_line" -p tcp -m state --state NEW --dport "$port" -j ACCEPT
    else
      iptables -A INPUT -p tcp -m state --state NEW --dport "$port" -j ACCEPT
    fi
  fi
done
# Make the same change in the saved rules, so it survives a restart. The file is edited rather
# than re-saved: a fresh save would also capture Docker's own rules, which Docker recreates.
rules=/etc/iptables/rules.v4
if [ -f "$rules" ]; then
  for port in 80 443; do
    line="-A INPUT -p tcp -m state --state NEW -m tcp --dport $port -j ACCEPT"
    if ! grep -qxF -- "$line" "$rules"; then
      awk -v add="$line" '!done && /^-A INPUT .*-j REJECT/ {print add; done=1} {print}' "$rules" > "$rules.new"
      mv "$rules.new" "$rules"
    fi
  done
fi

echo "== Application folder"
install -d -m 0755 /srv/constitution
install -d -m 0700 /srv/constitution/infra/production/secrets

echo "Server prepared."
