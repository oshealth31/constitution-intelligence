# Load and speed test (task T3)

**What was tested:** the built (production) API and web app with a real PostgreSQL database
and **fictional** data: the seeded sample organisations, 200 extra members, and a very large
fictional constitution (20 parts, 500 clauses, 1,000 sub-clauses, about 180,000 words: far
bigger than a typical club or church constitution). The test is `.github/workflows/load-test.yml`;
it runs when a `perf/…` branch is pushed. Scripts: `scripts/load/` (k6) and
`apps/web/perf/slow-network.mjs` (Chromium with slowed networks).

**Where:** one GitHub machine (4 processors, 16 GB), shared by the API, the web app, the
database **and the load generator**. No Docker or HTTPS proxy, except a Caddy proxy for the
slow-network test, for the same compression as production. **This is not the future server:**
treat the numbers as a guide, and repeat the test on the real server before relying on them.

**The virtual members are busier than real people:** each one opens the home page, the whole
large constitution and a search, with only 9 to 20 seconds of "reading" in between, for
minutes on end. 100 of them generate about as many requests as several hundred real members.

Results of 5 Nov 2026 (final run, after the fixes below).

## 1. A meeting: 120 members on one Wi-Fi network

All members at one address (like a church's Wi-Fi, or a mobile network that puts many phones
behind one address), signing in within a minute, with the **production limits**.

|                              | Before the fixes | After the fixes |
| ---------------------------- | ---------------- | --------------- |
| Sign-ins refused             | **1,034**        | **0**           |
| Requests refused (429)       | 5,015            | 0               |
| Requests failed              | 59 %             | 0 %             |
| Response time, 95 % within   | (mostly refused) | 86 ms           |
| Open the large constitution  | (mostly refused) | 330 ms (95 %)   |

**Fixed:**
- **Successful sign-ins no longer count towards the per-address sign-in limit.** Only failed
  ones do, so guessing passwords from one address is still stopped after 50 failures in 15
  minutes. Before, the 51st member to sign in at a meeting was locked out for 15 minutes.
- **Each signed-in member has their own request allowance** (600 a minute, as before for an
  address). An address as a whole is capped at 12,000 a minute (`API_RATE_LIMIT_PER_ADDRESS_PER_MINUTE`).
  That still stops a flood, including one with made-up cookies. Before, everyone at one address
  shared 600 a minute.

## 2. Capacity: more and more members at once

Per-address limits raised, so the server itself is measured. Response time for every request:

| Members active at once | Requests | Typical | 95 % within | 99 % within |
| ---------------------- | -------- | ------- | ----------- | ----------- |
| up to 25               | 1,607    | 12 ms   | 41 ms       | 66 ms       |
| up to 50               | 3,385    | 13 ms   | 50 ms       | 87 ms       |
| up to 100              | 9,029    | 19 ms   | 87 ms       | 147 ms      |
| up to 200              | 16,288   | 350 ms  | 902 ms      | 1,064 ms    |

- **Up to 100 very busy members: fast.** Between 100 and 200 it slows down: at 200, typical
  responses take a third of a second and opening the 500-clause constitution takes up to 3.2 s
  (95 %). The machine was overloaded at that point (load 5.6 on 4 processors, with the load
  generator on the same machine), so part of the slowdown is the test itself.
- **No server errors** at any level. The run's 282 refusals (0.9 %) came from the then
  6,000-a-minute address cap, with 200 busy members at one address; the cap is now 12,000.
- **Memory at peak:** API and web app about 580 MB together (Node), the web app's own server
  280 MB, database about 400 MB.
- **The large constitution** is about 2 MB per read uncompressed, but **110 KB** as sent by the
  production proxy (compressed). A typical constitution is a fraction of this.

## 3. Slow phone networks

Phone screen, first visit (nothing cached), through the same compression as production:

| Step                                      | Slow 3G (0.4 Mbit/s) | Fast 3G (1.6 Mbit/s) | 4G (9 Mbit/s) |
| ----------------------------------------- | -------------------- | -------------------- | ------------- |
| Sign-in page, ready to use (168 KB)       | 5.2 s                | 1.5 s                | 0.5 s         |
| Sign in, home page shows (~20 KB)         | 2.9 s                | 1.3 s                | 0.8 s         |
| Open the 500-clause constitution (110 KB) | 5.2 s                | 2.1 s                | 1.2 s         |
| Home page again, browser cache warm       | 2.3 s                | 1.0 s                | 0.4 s         |

On the slowest network everything opens within about 5 seconds. The first visit downloads
about 170 KB of app code; after that the browser keeps it.

## What this means for the pilot

- For the pilot (5–6 organisations), a modest server (2 processors, 4 GB memory) is very likely
  enough; this is an estimate from these numbers, to be confirmed by running this test on the
  real server.
- The meeting problem (members locked out on a shared network) was real and is fixed.

## Not covered

- The real server, the real internet, real phones (task T4), and Docker or Caddy overhead in
  the capacity runs.
- Uploading and processing documents under load (rare, administrators only), the Control
  Centre, and AI (off).
- Very long runs (hours or days).
