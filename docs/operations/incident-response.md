# Incident response

An incident is anything that harms, or might harm, the availability, integrity or
confidentiality of the service or of an organisation's data: an outage, data shown to the
wrong organisation, a suspected break-in, a lost laptop with access, a leaked secret, data
lost or corrupted.

## Roles (fill in before go-live)

| Role                                               | Person        | Backup person | Contact |
| -------------------------------------------------- | ------------- | ------------- | ------- |
| Incident lead (decides, communicates)              | _to be named_ | _to be named_ |         |
| Technical responder (server, database)             | _to be named_ | _to be named_ |         |
| Data protection contact (regulator, organisations) | _to be named_ |               |         |
| Hosting provider support                           | _provider_    |               |         |

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
   - Lost or stolen phone (two-step sign-in): see "Lost phone" below.
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

## Suspected unsafe file (virus or other harmful content)

Treat it as an incident (steps above) if anyone opened the file. Quarantine first, investigate
second.

1. **Quarantine at once.** Control Centre → Organisations → the organisation → **Uploaded
   files** → **Quarantine**, with the reason (for example "Owner reports a virus warning on
   download"). From that moment nobody can download the file by any route (the files page, the
   "Download the original" link, the portal logo), it is hidden in the reader and left out of
   organisation exports. Recorded as `file.quarantined`.
2. **See who already has a copy.** The card shows how many times the file was downloaded and
   "Show who" lists each person and time (from `file.downloaded` audit events). Quarantine
   **cannot reach copies already on people's computers**: contact each of them, ask them to
   delete it and to scan their device with their own antivirus.
3. **Check the file** outside the system, on a computer that is not used for anything
   important (for example upload the fingerprint shown in the audit event, or the file, to a
   scanning service, as long as the content is not confidential).
4. **Decide:**
   - **False alarm:** **Release**, with the reason. Downloads work again (`file.released`).
   - **Unsafe:** **Remove permanently**, with the reason. The stored file is deleted for good
     (`file.content_removed`); the record, and the text already read from it, stay, because
     the constitution version points at it. Ask the organisation to upload a clean copy as a
     new version.
5. Backups still contain the file until they expire (35 days by default). Never restore it from
   a backup without checking it first.

What this does **not** do: there is no automatic virus scan (decided for the pilot), and the
file is blocked where it is, not moved. The text readers never run anything inside a document,
and every download is sent as an attachment, never opened in the browser.

## Lost phone (two-step sign-in)

Not an emergency on its own (the phone alone cannot sign in without the password), but act the
same day.

1. **Confirm who is asking.** Call them back on a number you already have, or check in person.
   Never reset because of an email or message alone: that is how accounts are taken over.
2. **If they still have a recovery code:** they sign in with it (each works once). An Owner or
   Administrator then turns two-step sign-in off and on again on their profile page with the new
   phone. A Super Admin asks another Super Admin to reset it (step 3), then sets it up again.
3. **No recovery code:** another Super Admin opens Control Centre → **Support** → "Reset
   someone's two-step sign-in", with their email and the reason (for example "Lost phone; called
   back on the number on file"). This signs them out everywhere and emails them. It is recorded
   as `auth.two_step.reset`.
4. **The only Super Admin lost their phone:** someone with server access runs
   ```bash
   docker compose run --rm -T api node dist/cli/reset-two-step.js \
     --email <their address> --reason "<why, and how identity was confirmed>"
   ```
   They then sign in and set up two-step sign-in again before the Control Centre opens.
5. If the phone was **stolen** and the password may be known too: also change the password
   (Forgot password), and look in the Audit log for `auth.two_step.failed`,
   `auth.two_step.recovery_code_used` and `auth.login.*` events for that person.

## Quick commands

```bash
cd /srv/constitution/infra/production
docker compose ps                         # what is running and healthy
docker compose logs --since 30m api       # recent API log
docker compose stop caddy                 # take the site offline (data stays safe)
docker compose start caddy                # bring it back
docker compose --profile ops run --rm ops # backup now (before any risky step)
```
