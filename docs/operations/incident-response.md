# Incident response

An incident is anything that harms, or might harm, the availability, integrity or
confidentiality of the service or of an organisation's data: an outage, data shown to the
wrong organisation, a suspected break-in, a lost laptop with access, a leaked secret, data
lost or corrupted.

## Roles (fill in before go-live)

| Role | Person | Backup person | Contact |
| --- | --- | --- | --- |
| Incident lead (decides, communicates) | _to be named_ | _to be named_ | |
| Technical responder (server, database) | _to be named_ | _to be named_ | |
| Data protection contact (regulator, organisations) | _to be named_ | | |
| Hosting provider support | _provider_ | | |

## The steps

1. **Detect and record.** Open an incident note at once: time, who noticed, what was seen.
   Keep adding to it (times in UTC+2). Do not delete logs or containers you may need.
2. **Classify.**
   - _Sev 1:_ service down for everyone; any suspected cross-organisation exposure; suspected
     intrusion; leaked secret.
   - _Sev 2:_ one feature broken, or one organisation affected.
   - _Sev 3:_ minor fault with a workaround.
3. **Contain** (Sev 1 within 1 hour):
   - Suspected intrusion or exposure: take the site offline (`docker compose stop caddy`),
     keep the server running for investigation, take a snapshot of the disk if the provider
     allows it.
   - Compromised account: Control Centre → suspend the user (ends their sessions immediately),
     or suspend the organisation.
   - Leaked secret: rotate it now ([secrets.md](secrets.md)); rotate the database password and
     restart the API if in doubt.
   - Attack traffic: block the source addresses at the firewall; the application's own limits
     already slow it down (status 429).
4. **Investigate.**
   - API logs by request ID: `docker compose logs api --since 2h`.
   - Audit log: Control Centre → Audit log, filtered by organisation and action. Look for
     `support.content_accessed`, `permission.denied`, `auth.login.*`, suspensions.
   - Caddy access log for addresses and paths.
5. **Recover.** Fix, or roll back ([rollback.md](rollback.md)). If data is damaged or lost,
   restore the last good backup into a new database and compare
   ([backup-and-restore.md](backup-and-restore.md)). Bring the site back and watch the alerts.
6. **Notify.**
   - Affected organisations' Owners: as soon as the facts are known, in plain language. Say
     what happened, what data, what was done, and what they should do.
   - **Personal data breach:** under the Data Protection Act, 2024 (Act No. 18 of 2024) the
     data controller must notify the Information and Data Protection Commission **within 72
     hours** of becoming aware of a breach, and tell the people affected without undue delay
     when their rights are at risk. Which party is the controller (the organisation, Constitution
     Intelligence, or both for different data) must be settled in the agreements before go-live,
     with a lawyer, together with the notification form. Start the 72-hour clock when the breach
     is confirmed, and record every decision.
7. **Review** within 5 working days, without blame: timeline, cause, what worked, what to
   change. Changes go into the backlog with owners and dates.

## Quick commands

```bash
cd /srv/constitution/infra/production
docker compose ps                         # what is running and healthy
docker compose logs --since 30m api       # recent API log
docker compose stop caddy                 # take the site offline (data stays safe)
docker compose start caddy                # bring it back
docker compose --profile ops run --rm ops # backup now (before any risky step)
```
