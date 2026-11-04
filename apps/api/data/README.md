# apps/api/data

## breached-passwords.bin

Passwords known from data leaks, used to refuse them when someone chooses a password (Task D5,
`src/modules/auth/breached-passwords.ts`). The check runs entirely on the server: nothing about
a password is sent anywhere.

- **Contents:** about 738,000 leaked passwords of 12 to 128 characters (shorter ones are refused
  by the length rule anyway), lower-cased, each stored as the first 6 bytes of its SHA-256, sorted.
  The file contains no readable passwords. A different password matching by chance is about 1 in
  380 million per check.
- **Built by:** `python3 scripts/build-breached-password-list.py <SecLists checkout>`.
  SHA-256 of the file: `4e6f45bc60634655defc0f71bcc937f346b31833fae196592d0d22d39cd4ac87`.
- **Source:** [SecLists](https://github.com/danielmiessler/SecLists) by Daniel Miessler, Jason
  Haddix and contributors, commit `e55e2fb23eeafed6d158fb06a83c0f8cee85b313`, folder
  `Passwords/Common-Credentials` (files listed in the build script). MIT licence: the full
  notice is in [SECLISTS-LICENSE.txt](SECLISTS-LICENSE.txt) and ships with the application.
- **Updating:** run the build script on a newer SecLists checkout, update the commit and checksum
  above, and check that the tests still pass.
