# Secret management

## Rules

1. **Production secrets are generated for production.** Never reuse a development or test
   password, key or certificate, and never copy a development `.env` file to a server.
2. Secrets live only in `infra/production/secrets/` on the server: one file each, owner root,
   mode `0600` (`0640` with group 999 for the database key), excluded from git (`.gitignore`),
   from Docker image builds (`.dockerignore`) and from backups' plain text (backups are encrypted).
3. Containers receive secrets as read-only files under `/run/secrets/` (Compose secrets) and
   read them through `*_FILE` settings (`DATABASE_URL_FILE`, `ANTHROPIC_API_KEY_FILE`). Secret
   values are therefore not in environment variables, `docker inspect` output, or logs.
4. Nothing secret starts with `NEXT_PUBLIC_` and nothing secret is in the web image: the browser
   never receives a key.
5. Two people know where the backup passphrase is kept offline; one person alone can rotate
   the rest. Every rotation is recorded in the change log (who, what, when, not the value).
6. Leaving staff: rotate every secret they could read, the same day.

## Creating the files (first installation)

On the server, as root, in `/srv/constitution/infra/production/secrets/`:

```bash
umask 077
openssl rand -hex 32 > postgres_password      # administrator account (superuser) – admin only
openssl rand -hex 32 > app_db_password        # application account constitution_app
openssl rand -hex 32 > backup_passphrase      # encrypts backups and exports
printf 'postgresql://constitution_app:%s@postgres:5432/constitution' "$(cat app_db_password)" > database_url
cp database_url database_owner_url            # migrations; separate account planned (U3)

# Database TLS certificate, signed by a private certificate authority kept OFF the server.
openssl req -x509 -newkey rsa:4096 -nodes -days 3650 -subj "/CN=Constitution DB CA" \
  -keyout /secure/offline/database_ca.key -out database_ca.crt
openssl req -newkey rsa:2048 -nodes -subj "/CN=postgres" -keyout database_server.key -out server.csr
printf 'subjectAltName=DNS:postgres\n' > san.ext
openssl x509 -req -in server.csr -CA database_ca.crt -CAkey /secure/offline/database_ca.key \
  -CAcreateserial -days 825 -extfile san.ext -out database_server.crt
rm server.csr san.ext
chown root:999 database_server.key && chmod 0640 database_server.key
chmod 0600 postgres_password app_db_password backup_passphrase database_url database_owner_url
```

Write the backup passphrase on paper (or a password manager the owner controls), seal it, and
store it away from the server. **Without it no backup can be restored.**

With a managed database service, skip the certificate steps: use the provider's certificate
authority file as `database_ca.crt` and the provider's connection string in `database_url`.

## Rotation

| Secret                                    | How often                                  | How                                                                                                                                                                |
| ----------------------------------------- | ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `app_db_password`                         | Yearly, and when anyone with access leaves | `ALTER ROLE constitution_app PASSWORD '...'` as the administrator, update `app_db_password`, `database_url`, `database_owner_url`, then `docker compose up -d api` |
| `postgres_password`                       | Yearly                                     | `ALTER ROLE constitution_owner PASSWORD '...'`, update the file                                                                                                    |
| Database certificate                      | Before it expires (825 days)               | Issue a new one with the same CA; restart `postgres`                                                                                                               |
| `backup_passphrase`                       | When someone who knew it leaves            | New file; **keep the old passphrase** until every backup made with it has expired                                                                                  |
| AI provider key (if AI is ever turned on) | Every 90 days                              | Provider console; `ANTHROPIC_API_KEY_FILE`                                                                                                                         |
| Session tokens                            | Automatic                                  | Users can "sign out everywhere"; suspending a user ends their sessions                                                                                             |

## What is not secret

`api.env` (addresses, switches, limits) and the Compose `.env` (image tags, site address) hold
no secrets and may be kept in an internal change log. `BILLING_PAYMENT_INSTRUCTIONS` is shown to
organisations and is not secret either.

## Not yet in place

- A dedicated secret manager (for example HashiCorp Vault, or the hosting provider's) with
  access logs. Files on one server are acceptable for a controlled pilot, not long term.
- A separate database account for migrations (owner) and for the running API (U3 in
  docs/security/security-review.md). Today both use `constitution_app`, which is **not** a
  superuser (checked by the deployment check workflow).
