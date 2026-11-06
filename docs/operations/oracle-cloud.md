# Hosting on Oracle Cloud (Task S2)

This is the step-by-step guide for the production server: a free Oracle Cloud server in
Johannesburg, set up and updated from GitHub with the **Deploy** workflow, so nobody needs to
type commands on the server.

> **Data protection:** Johannesburg is in South Africa. Hosting there is a cross-border
> transfer under the Botswana Data Protection Act, 2024. Use the server for **testing with
> made-up data** until the lawyer review (legal tasks) confirms it may hold real members' data.

Parts A to D are done by the owner, in a web browser. A computer is easier for part D (copying
a key file), but a phone works too.

## A. Create the Oracle account

1. Go to **oracle.com/cloud/free** and tap **Start for free**.
2. Country: **Botswana**. Enter your name and email, then confirm the email Oracle sends.
3. **Home region: South Africa Central (Johannesburg).** It cannot be changed later, and the
   free server must be in the home region.
4. Account type: **Individual**. Add your phone number and your **debit card**. Oracle
   only checks the card. It may hold a small amount for a few days, then releases it. Nothing
   is charged as long as the account stays on the free tier. **Do not upgrade the account.**
5. When asked, set up two-step sign-in for the Oracle account (Oracle Mobile Authenticator or
   another authenticator app). Whoever controls this account controls the server.

## B. Create the server

1. Menu (☰) → **Compute** → **Instances** → **Create instance**.
2. Name: `constitution-prod`.
3. **Image and shape → Edit**:
   - **Change image** → **Canonical Ubuntu** → **24.04** (not "Minimal") → Select.
   - **Change shape** → **Ampere** → **VM.Standard.A1.Flex** → **2 OCPUs** and **12 GB**
     memory → Select. It must show **Always Free-eligible**.
4. **Networking**: keep **Create new virtual cloud network** and **Create new public subnet**;
   **Assign a public IPv4 address: Yes**.
5. **Add SSH keys**: choose **Generate a key pair for me**, then tap **Download private key**.
   This file is the key to the server: keep it safe and never send it in a chat or email.
6. **Boot volume**: tick **Specify a custom boot volume size** → **100** GB (the free
   allowance is 200 GB in total).
7. Tap **Create**. After a minute or two the state shows **Running**.
   - **"Out of capacity"** means Oracle's free servers in Johannesburg are all in use at
     that moment. Try again later (morning or night often works). Nothing is charged
     for a failed attempt.
8. On the instance page, note the **Public IP address** (four numbers, such as `129.151.x.x`).

## B2. Automatic retry when Oracle is "out of capacity"

Free Arm servers in Johannesburg are often all in use. Instead of trying by hand, the
**Oracle server (create, retrying)** workflow ([.github/workflows/oracle-server.yml](../../.github/workflows/oracle-server.yml))
tries every few minutes, day and night. It uses
[ops/server/oracle-create-server.sh](../../ops/server/oracle-create-server.sh) and the same
settings as B3–B6: Ubuntu 24.04, 2 OCPUs and 12 GB (then 1 OCPU and 6 GB), 100 GB at
10 VPUs/GB, and a public IP address. When the server exists, it opens ports 80 and 443
([ops/server/oracle-open-web-ports.sh](../../ops/server/oracle-open-web-ports.sh)) and switches
itself off. It never creates a second Arm server, and it never goes above the free allowance.

The network must exist first. Creating any server once in the console makes it, even one that
failed with "out of capacity" or the small E2.1.Micro.

What the owner does, once:

1. **SSH key.** Use the private key file downloaded in B5. If there is none, start "Create
   instance" again, choose **Generate a key pair for me**, tap **Download private key**, then
   **Cancel**. Add it as the GitHub secret `DEPLOY_SSH_KEY` (part D).
2. **Oracle API key** (lets GitHub create the server for you):
   1. Oracle → profile icon (top right) → **My profile** → **Tokens and keys** (or **API
      keys**) → **Add API key**.
   2. Choose **Generate API key pair** → **Download private key** (a `.pem` file) → **Add**.
   3. Oracle shows a **Configuration file preview** with `user=`, `fingerprint=` and
      `tenancy=` lines.
3. Add four more GitHub secrets (part D):

   | Name               | Value                                                                   |
   | ------------------ | ----------------------------------------------------------------------- |
   | `OCI_USER_OCID`    | The value after `user=` (starts with `ocid1.user.`)                     |
   | `OCI_FINGERPRINT`  | The value after `fingerprint=` (pairs of letters and numbers with `:`)  |
   | `OCI_TENANCY_OCID` | The value after `tenancy=` (starts with `ocid1.tenancy.`)               |
   | `OCI_API_KEY`      | The whole `.pem` file from step 2.2, from `-----BEGIN` to the last line |

The workflow then runs by itself. GitHub → **Actions** → **Oracle server (create, retrying)**
shows each attempt: "No free Arm server available right now" means it will try again. When
it succeeds, the server appears under Compute → Instances. Copy its **Public IP address** into
`DEPLOY_HOST`.

Anyone holding the API key can manage the Oracle account. It lives only in GitHub's encrypted
secrets. **Delete it in Oracle (Tokens and keys) once the server exists**, unless it is still
needed.

## C. Open the web ports in Oracle's network

1. On the instance page, under **Primary VNIC**, tap the **Subnet** link.
2. Tap **Security** (or **Security Lists**) → **Default Security List** → **Add Ingress Rules**.
3. Add a rule: Source CIDR `0.0.0.0/0`, IP protocol **TCP**, Destination port **80**. Tap
   **Add Ingress Rules**.
4. Do the same again for port **443**.

Port 22 (SSH) is already open. The server accepts keys only, with no passwords, and blocks
addresses that keep failing (see "Security notes" below).

## D. Put the keys in GitHub

On GitHub: the repository → **Settings** → **Secrets and variables** → **Actions** → **New
repository secret**. Add four secrets. Paste each value **only** into GitHub, never into a chat.

| Name             | Value                                                                                                                                                                                            |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `DEPLOY_HOST`    | The server's public IP address from B8.                                                                                                                                                          |
| `DEPLOY_SSH_KEY` | The **whole** content of the private key file from B5, from `-----BEGIN` to the last `-----` line. On a computer, open the file with a text editor (Notepad, TextEdit) and copy everything.      |
| `SMTP_LOGIN`     | Brevo → **SMTP & API** → **SMTP** tab → the **Login** shown there.                                                                                                                               |
| `SMTP_KEY`       | Brevo → **SMTP & API** → **SMTP** → **Generate a new SMTP key**, named `production server`. Copy it straight into GitHub. Brevo shows it only once; if it is lost, delete it and make a new one. |

Then tell Claude (or the technical person) **"Server ready"**. The IP address and keys are
already in GitHub, so they are not needed in the chat.

## E. The Deploy workflow (technical)

GitHub → **Actions** → **Deploy** → **Run workflow**, then choose a task:

| Task                 | What it does                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `status`             | Shows uptime, disk and memory, what is running, and the last releases.                                                                                                                                                                                                                                                                                                                                                                          |
| `prepare-server`     | Once, on a new server: [ops/server/prepare.sh](../../ops/server/prepare.sh). Installs Docker from Docker's package source, turns on automatic security updates, sets SSH to keys only with no root login, turns on fail2ban, and opens ports 80 and 443 in the server's own firewall. Safe to run again.                                                                                                                                        |
| `release`            | Builds the images for the chosen commit on an Arm machine (the same type as the server) and copies the application files, the email secrets and the images to the server. Then [ops/server/release.sh](../../ops/server/release.sh) creates any missing secrets ([ops/server/make-secrets.sh](../../ops/server/make-secrets.sh), never replacing existing ones), writes the settings, takes a backup if a database exists, migrates and starts. |
| `create-super-admin` | Creates a Platform Super Admin. The one-time link is **emailed** to them (`create-super-admin --send-email`) and never printed.                                                                                                                                                                                                                                                                                                                 |

- **Settings** that are not secret live in [deploy/production.env](../../deploy/production.env)
  (site address, sender address, payment instructions). Change them in a pull request, then
  run `release`. The server's `.env` and `api.env` are rewritten from them on every release.
  The previous versions are kept as `.env.previous` and `api.env.previous`.
- **Secrets** are created on the server and never leave it, except the two email values,
  which come from GitHub secrets. Changing `SMTP_KEY` and running `release` rotates the email
  key.
- **The server's identity:** on the first connection the workflow shows the server's key
  fingerprint and a warning. Record that key in `infra/production/known_hosts` (a pull request).
  From then on, a server with a different key is refused.
- **Public logs:** this repository is public, and so are the workflow's logs. The workflow
  never prints a secret, a one-time link, or the new Super Admin's email address or name (they
  are hidden in the log).
- **Approval:** only people with write access to the repository can run the workflow. To make
  every run wait for the owner's approval, add the owner under **Settings → Environments →
  production → Required reviewers**.
- **Rehearsal:** the **Deploy rehearsal** workflow runs `prepare-server`, a first installation
  and an upgrade on a throwaway GitHub machine on every change to these files. It checks that
  the secrets survive the upgrade, that a backup is made first, and that the site answers
  through HTTPS.

### Differences from the manual procedure in deployment.md

- The database's private certificate authority is created on the server, and its key is
  deleted right after it signs the database certificate, instead of being kept offline. To
  renew the certificate (every 825 days), delete `database_ca.crt`, `database_server.crt` and
  `database_server.key` and run `release`.
- `backup_passphrase` and `mfa_encryption_key` are created on the server. **Copy them to the
  sealed offline place** (secrets.md) as part of the go-live check (task S7). Until then,
  nothing on this server may be needed by anyone.

### Security notes

- SSH must be reachable from GitHub's machines, whose addresses change, so port 22 is open to
  the internet instead of only to named administrators' addresses (deployment.md). In
  exchange, the server accepts keys only (no passwords, no root login, three tries per
  connection), fail2ban blocks addresses that keep failing, and the key lives only in GitHub's
  encrypted secrets and with the owner.
- Anyone who can change the `DEPLOY_SSH_KEY` secret or run the workflow can control the
  server. Keep write access to the repository to the owner and named technical people, and use
  two-step sign-in on GitHub and Oracle.
- Oracle can reach the server's disks. This belongs in the data-protection review.
