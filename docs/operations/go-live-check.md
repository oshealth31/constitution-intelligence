# Go-live check (Task S7)

The last step before the first real organisation (RBPC) uses the platform with real members'
data. It collects the evidence for conditions C1–C7 in
[production-readiness.md](production-readiness.md) and ends with the owner's written go-ahead.
**Until the owner signs below, use made-up test data only.**

## Status (13 November 2026)

| #   | Condition | Status | Evidence |
| --- | --- | --- | --- |
| C1  | Server running; hosting destination approved | **Running; approval waits for the data-protection review (L stages)** | Oracle Cloud Johannesburg ([oracle-cloud.md](oracle-cloud.md)); HTTPS live check passes daily |
| C2  | Email working on the real server | ✅ | Administrator and invitation emails delivered via Brevo; domain authenticated |
| C3  | Two-step sign-in; `mfa_encryption_key` kept offline | **Two-step on; key not yet copied offline** (step 2 below) | Super Admin set up with an authenticator app |
| C4  | Pilot agreement with RBPC, privacy notice for members | **Not done (L stages)** | — |
| C5  | Off-site backups running; one restore test on the real backups | **Off-site running (S6); restore test: step 1 below** | Nightly 01:30 backup, checked copy in Oracle Object Storage; delete refused for the server key |
| C6  | Monitoring and alerts; two named responders | ✅ | Watchdog every 10 min, daily outside check, UptimeRobot; test alert received |
| C7  | Deployment check green on the release; owner's written go-ahead | **Checks green; go-ahead below, after C1 and C4** | All CI checks on every merged change |

Also open before general availability (not needed for the RBPC pilot, but recommended):
independent penetration test (U11), real-phone checks (T4), screen-reader check (T2 manual).

## Step 1 — Restore test on the real backups (Claude runs it)

Deploy workflow task `restore-test` ([ops/server/restore-test.sh](../../ops/server/restore-test.sh)):
downloads the newest **off-site** backup, restores it into a **new** database and storage on the
server, compares every table and file with the live data, checks that the audit log is still
append-only and that row-level security still isolates organisations, starts the API on the
restored copy, then removes everything it made. The live data is never touched. The result is
recorded in [backup-and-restore.md](backup-and-restore.md#restore-test-record). Repeat it
**every quarter** and after any change to the backup scripts.

## Step 2 — Copy the two recovery keys to a safe offline place (owner, once)

If the server is lost, the off-site backups can only be opened with **`backup_passphrase`**,
and two-step sign-in only keeps working with **`mfa_encryption_key`**. Today both exist only on
the server. They must also be kept **offline** (on paper, in two sealed envelopes in two safe
places), never in email, chat, cloud notes or photos.

They are shown nowhere by the workflows, because GitHub logs are public. Read them once from a
**computer** with Oracle Cloud Shell (a terminal in the browser):

1. Sign in at cloud.oracle.com on a computer. Click the **Cloud Shell** icon (`>_`) at the top.
2. In Cloud Shell, open the menu (gear icon) → **Upload**, and upload the server's SSH private
   key file (`ssh-key-….key`, the one in the GitHub secret `DEPLOY_SSH_KEY`).
3. Type, replacing `<IP>` with the server's public IP address:

   ```bash
   chmod 600 ssh-key-*.key
   ssh -i ssh-key-*.key ubuntu@<IP> 'for f in backup_passphrase mfa_encryption_key; do
     echo "$f:"; sudo cat /srv/constitution/infra/production/secrets/$f | fold -w 8 | paste -sd " "; done'
   ```

   (Answer `yes` to the question about the server's fingerprint; it must be
   `SHA256:7tzv94yA2Jjwjvui9l2YtHXY73STe7sa8dpuQLjWoGY`.)
4. Write both values on paper exactly as shown (8 groups of 8 characters each), labelled with
   their names and the date. Check each group twice. Make two copies; seal each in an envelope;
   keep them in two different safe places.
5. Clean up Cloud Shell: `rm ssh-key-*.key && history -c`, then close it.

## Step 3 — Decision: lock the backup retention rules?

The off-site buckets have retention rules (backups 35 days, audit seals 7 years) that are **not
locked**: the owner can still change or remove them. Locking makes them permanent: not even the
owner (or someone who steals the owner's Oracle account) can shorten them, but they can never be
undone. **Recommendation: do not lock during the pilot.** Lock once the lawyer has confirmed the
retention periods (L stages). How: Oracle → Storage → Buckets → the bucket → Retention rules →
Edit → set a lock date.

## Step 4 — Owner's written go-ahead

To be completed when C1–C7 are all met (after the L stages):

> I approve the use of Constitution Intelligence with real data for the pilot with
> Revelation Blessed Peace Church, on the server and settings described above.
>
> Name: ____________________ Date: ____________ Signature: ____________________

Record the go-ahead (date and the release version from the Control Centre's System health) in
[production-readiness.md](production-readiness.md).
