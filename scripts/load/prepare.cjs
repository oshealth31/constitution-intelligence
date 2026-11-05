// Load test data (task T3). FICTIONAL only, for a throwaway CI database: never run this
// against a real database. Run from apps/api (so `pg` and `@node-rs/argon2` resolve):
//   DATABASE_URL=... LOAD_USERS=200 LOAD_PASSWORD=... node ../../scripts/load/prepare.cjs
//
// Adds, to the seeded "Sample Community Choir (fictional)":
//   - LOAD_USERS member accounts loadtest-<n>@sample.test, all with LOAD_PASSWORD;
//   - a second, very large published constitution: 20 parts, 500 clauses, 1,000 sub-clauses,
//     about 200,000 words (generated text), to test reading and searching a big document.
'use strict';
const { Client } = require('pg');
const { hash } = require('@node-rs/argon2');

const SLUG = process.env.LOAD_SLUG || 'sample-community-choir';
const USERS = Number(process.env.LOAD_USERS || 200);
const PASSWORD = process.env.LOAD_PASSWORD;
if (!process.env.DATABASE_URL || !PASSWORD) {
  console.error('Set DATABASE_URL and LOAD_PASSWORD.');
  process.exit(1);
}
if (!/localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL)) {
  console.error('Refusing: load test data goes only into a local throwaway database.');
  process.exit(1);
}

const WORDS = (
  'members committee meeting quorum treasurer secretary chairperson vote election notice ' +
  'resolution annual general special accounts audit property trustees discipline appeal ' +
  'membership subscription register minutes amendment dissolution assets church society'
).split(' ');

async function main() {
  const db = new Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();
  try {
    const org = (await db.query('SELECT id FROM organisations WHERE slug = $1', [SLUG])).rows[0];
    if (!org) throw new Error(`No organisation ${SLUG}; run the development seed first.`);
    const owner = (
      await db.query(
        `SELECT m.user_id FROM memberships m WHERE m.organisation_id = $1 AND m.role = 'owner' LIMIT 1`,
        [org.id],
      )
    ).rows[0];

    // Members (one password hash, computed once, like the API does).
    const passwordHash = await hash(PASSWORD, {
      memoryCost: 19_456,
      timeCost: 2,
      parallelism: 1,
      outputLen: 32,
    });
    await db.query(
      `WITH people AS (
         INSERT INTO users (email, display_name, password_hash)
         SELECT 'loadtest-' || n || '@sample.test', 'Load Test Member ' || n, $1
         FROM generate_series(1, $2::int) n
         ON CONFLICT DO NOTHING
         RETURNING id)
       INSERT INTO memberships (organisation_id, user_id, role)
       SELECT $3, id, 'member' FROM people`,
      [passwordHash, USERS, org.id],
    );

    // The large constitution, built as a draft and then moved through the workflow.
    const constitution = (
      await db.query(
        `INSERT INTO constitutions (organisation_id, title) VALUES ($1, $2) RETURNING id`,
        [org.id, 'Large Constitution (fictional, load test)'],
      )
    ).rows[0];
    const version = (
      await db.query(
        `INSERT INTO constitution_versions (organisation_id, constitution_id, version_number, label, status, created_by_user_id, extraction_status)
         VALUES ($1, $2, 1, 'Load test version', 'draft', $3, 'succeeded') RETURNING id`,
        [org.id, constitution.id, owner ? owner.user_id : null],
      )
    ).rows[0];
    const sentence = (seed) =>
      Array.from({ length: 18 }, (_, index) => WORDS[(seed * 7 + index * 13) % WORDS.length]).join(
        ' ',
      ) + '.';
    let position = 0;
    for (let part = 1; part <= 20; part += 1) {
      const partRow = (
        await db.query(
          `INSERT INTO sections (organisation_id, version_id, kind, ref_key, number, heading, body, position)
           VALUES ($1, $2, 'part', $3, $4, $5, '', $6) RETURNING id`,
          [org.id, version.id, `p${part}`, `Part ${part}`, `Part ${part} heading`, position++],
        )
      ).rows[0];
      for (let c = 1; c <= 25; c += 1) {
        const clause = (part - 1) * 25 + c;
        const body = Array.from({ length: 12 }, (_, s) => sentence(clause * 31 + s)).join(' ');
        const clauseRow = (
          await db.query(
            `INSERT INTO sections (organisation_id, version_id, parent_section_id, kind, ref_key, number, heading, body, position)
             VALUES ($1, $2, $3, 'clause', $4, $5, $6, $7, $8) RETURNING id`,
            [
              org.id,
              version.id,
              partRow.id,
              `c${clause}`,
              String(clause),
              `Clause ${clause} heading`,
              body,
              position++,
            ],
          )
        ).rows[0];
        for (const letter of ['a', 'b']) {
          await db.query(
            `INSERT INTO sections (organisation_id, version_id, parent_section_id, kind, ref_key, number, heading, body, position)
             VALUES ($1, $2, $3, 'subclause', $4, $5, NULL, $6, $7)`,
            [
              org.id,
              version.id,
              clauseRow.id,
              `c${clause}${letter}`,
              `(${letter})`,
              Array.from({ length: 4 }, (_, s) =>
                sentence(clause * 17 + s + letter.charCodeAt(0)),
              ).join(' '),
              position++,
            ],
          );
        }
      }
    }
    for (const status of ['in_review', 'approved', 'published']) {
      await db.query(
        `UPDATE constitution_versions SET status = $1, published_at = CASE WHEN $1 = 'published' THEN now() END WHERE id = $2`,
        [status, version.id],
      );
    }
    const words = (
      await db.query(
        `SELECT count(*)::int AS sections, sum(array_length(regexp_split_to_array(body, '\\s+'), 1))::int AS words
         FROM sections WHERE version_id = $1`,
        [version.id],
      )
    ).rows[0];
    console.log(
      JSON.stringify({
        organisationId: org.id,
        constitutionId: constitution.id,
        versionId: version.id,
        members: USERS,
        ...words,
      }),
    );
  } finally {
    await db.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
