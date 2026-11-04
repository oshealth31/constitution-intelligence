# Maintenance

## Routine

| When               | Task                                                                                                       | How                                                                                                                        |
| ------------------ | ---------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| Daily (automatic)  | Encrypted backup, copied off the server                                                                    | Cron: `docker compose --profile ops run --rm ops`, then the off-site copy ([backup-and-restore.md](backup-and-restore.md)) |
| Daily              | Glance at alerts and Control Centre → System health                                                        |                                                                                                                            |
| Weekly             | Read the "Security scans" results and Dependabot pull requests; merge safe updates after CI                | GitHub                                                                                                                     |
| Weekly (automatic) | Deployment check, including a full backup-and-restore test on a throwaway runner                           | GitHub Actions, Mondays                                                                                                    |
| Monthly            | Operating-system and Docker updates; restart in the maintenance window                                     | `apt upgrade`, `docker compose pull` for Caddy/Postgres images, then `up -d`                                               |
| Monthly            | Review Super Admin and organisation Owner accounts; remove leavers                                         | Control Centre                                                                                                             |
| Monthly            | Check disk space for database, storage, backups and logs                                                   | `df -h`, `docker system df`                                                                                                |
| Quarterly          | **Restore test on the real backups** into a separate database on a separate machine, and record the result | [backup-and-restore.md](backup-and-restore.md)                                                                             |
| Quarterly          | Check retention: organisations past their retention period (Control Centre → Billing)                      | [offboarding-and-retention.md](offboarding-and-retention.md)                                                               |
| Yearly             | Rotate database passwords; review this documentation; incident-response drill                              | [secrets.md](secrets.md)                                                                                                   |
| Before expiry      | Database TLS certificate (825 days)                                                                        | [secrets.md](secrets.md)                                                                                                   |

## Maintenance windows

Default window: **Sunday 06:00–08:00 Botswana time**. Tell organisation Owners at least 3
working days ahead for planned work that causes downtime (migrations, database upgrades).
Short restarts for application releases take seconds and need no notice.

## Updating PostgreSQL

- Minor versions (16.x): new image, `docker compose up -d postgres`, after a backup.
- Major versions (16 → 17): a project of its own. Backup, restore into the new version on a
  test machine, run the full test suite against it, then plan the window. Never in place
  without a tested restore.

## Housekeeping inside the database

- Expired sessions, used reset links and old rate-limit counters stay as small rows. Deleting
  them is safe. A scheduled cleanup task is not built yet (open item); until then, monthly:

```sql
DELETE FROM sessions WHERE expires_at < now() - interval '30 days' OR revoked_at < now() - interval '30 days';
DELETE FROM password_reset_tokens WHERE expires_at < now() - interval '30 days';
DELETE FROM auth_rate_limits WHERE window_started_at < now() - interval '1 day';
```

- `VACUUM` and `ANALYZE` are automatic (autovacuum); no manual action is needed at this size.
- The audit log is append-only by design and is never cleaned up by hand.
