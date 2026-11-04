# Secret files (server only)

This folder holds the production secrets as one file each. **The files are never committed**
(this README is the only tracked file) and must be readable only by the account that runs
Docker (`chmod 600`, owner root). Create them as described in `docs/operations/secrets.md`:

| File | Contents |
| --- | --- |
| `postgres_password` | Password of the database administrator account (`constitution_owner`, superuser; administration only) |
| `app_db_password` | Password of the application account (`constitution_app`) |
| `database_owner_url` | Connection string for migrations (`constitution_app` today; see U3) |
| `database_url` | Connection string the API uses (`constitution_app`) |
| `database_ca.crt` | Certificate authority that signed the database certificate |
| `database_server.crt`, `database_server.key` | The database server's TLS certificate and key |
| `backup_passphrase` | Passphrase that encrypts backups and exports. **Also kept offline in a sealed place**: without it no backup can be restored |
