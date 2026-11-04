# Rollback

Every release uses images tagged with their commit (`constitution-api:<sha>`), and a backup
is taken just before. That allows two kinds of rollback.

## A. The release had no migrations, or only backward-compatible ones (the usual case)

```bash
cd /srv/constitution/infra/production
# Put the previous tags back in .env (API_IMAGE, WEB_IMAGE, OPS_IMAGE), then:
docker compose up -d --wait api web
bash ../../ops/check-health.sh https://<address>
```

Takes about a minute and loses no data. The database keeps the new columns and tables, which
the previous version ignores. That is why migrations must be backward compatible
([database-migrations.md](database-migrations.md)).

## B. A migration broke data, or the old version cannot run on the new structure

There are no "down" migrations. Restore the backup taken just before the release:

1. Take the site offline: `docker compose stop caddy`.
2. Take one more backup of the current state, for investigation.
3. Restore the pre-release backup into a **new** database and new storage folder
   ([backup-and-restore.md](backup-and-restore.md), "Restoring for real").
4. Point `database_url` at the restored database (and the storage volume, if files changed),
   put the previous image tags back, and run `docker compose up -d --wait api web caddy`.
5. Check the site, then tell organisations what happened. Anything done between the backup and
   the rollback (new uploads, approvals, sign-ups) is lost, unless it is copied over from the
   investigation backup by hand.

## Deciding

| Situation | Rollback |
| --- | --- |
| New version crashes or misbehaves, migrations were additive | A |
| Wrong data written by the new version | A, then repair with a new migration or a careful script, or B if repair is not safe |
| A migration failed halfway | Nothing to roll back: pending migrations run in one transaction and the failed batch is not applied. Fix and re-run |
| Migration dropped or rewrote data | B |

Record every rollback in the change log and the incident note.
