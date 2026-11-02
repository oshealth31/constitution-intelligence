// Fictional portal branding and reading content for local development and browser tests.
// Never used in production code paths.
import { deflateSync } from 'node:zlib';
import { organisationBranding, sections, type Database } from '@constitution/db';
import { and, eq } from 'drizzle-orm';

export interface SampleBranding {
  displayName: string;
  tagline: string;
  welcomeMessage: string;
  primaryColour: string;
  secondaryColour: string;
  accentColour: string;
}

/** Two clearly different looks, so it is obvious which portal you are in. */
export const SAMPLE_BRANDING: Record<'choir' | 'netball', SampleBranding> = {
  choir: {
    displayName: 'Sample Community Choir',
    tagline: 'Singing together (a fictional organisation)',
    welcomeMessage:
      'Welcome to our choir’s constitution.\n' +
      'Here you can read our rules, search for any topic and see what members have agreed. ' +
      'If anything is unclear, please ask a committee member.',
    primaryColour: '#4A2B6B',
    secondaryColour: '#F6EEDC',
    accentColour: '#D9A21B',
  },
  netball: {
    displayName: 'Sample Netball Club',
    tagline: 'Play fair, play together (a fictional organisation)',
    welcomeMessage:
      'Dumelang! This is our club rulebook.\n' +
      'Use Search to find a rule quickly, or Read to go through the constitution section by section.',
    primaryColour: '#0E5A3A',
    secondaryColour: '#E7F4EC',
    accentColour: '#F28C28',
  },
};

export async function applySampleBranding(
  db: Database,
  organisationId: string,
  branding: SampleBranding,
): Promise<void> {
  await db
    .insert(organisationBranding)
    .values({ organisationId, ...branding })
    .onConflictDoUpdate({
      target: organisationBranding.organisationId,
      set: { ...branding, updatedAt: new Date() },
    });
}

// ----- A tiny PNG logo (a ring and a dot), generated without any image library ---------------

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buffer: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc = CRC_TABLE[(crc ^ byte) & 0xff]! ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

function rgb(hex: string): [number, number, number] {
  const value = Number.parseInt(hex.slice(1), 16);
  return [(value >> 16) & 0xff, (value >> 8) & 0xff, value & 0xff];
}

/** A square PNG: `background` circle with an `accent` ring and centre dot, on transparency. */
export function makeSampleLogoPng(background: string, accent: string, size = 128): Buffer {
  const [br, bg, bb] = rgb(background);
  const [ar, ag, ab] = rgb(accent);
  const rows: Buffer[] = [];
  const centre = (size - 1) / 2;
  for (let y = 0; y < size; y += 1) {
    const row = Buffer.alloc(1 + size * 4); // filter byte 0, then RGBA pixels
    for (let x = 0; x < size; x += 1) {
      const distance = Math.hypot(x - centre, y - centre) / (size / 2);
      let pixel: [number, number, number, number] = [0, 0, 0, 0];
      if (distance <= 1) pixel = [br, bg, bb, 255];
      if (distance > 0.62 && distance < 0.78) pixel = [ar, ag, ab, 255];
      if (distance < 0.28) pixel = [ar, ag, ab, 255];
      row.set(pixel, 1 + x * 4);
    }
    rows.push(row);
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8; // bit depth
  header[9] = 6; // colour type: RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(Buffer.concat(rows))),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ----- Fuller sample constitution, arranged in parts, for the reading interface ---------------

type SectionKind = 'part' | 'clause' | 'subclause';
interface Outline {
  refKey: string;
  kind: SectionKind;
  number: string | null;
  heading: string | null;
  body: string;
  children?: Outline[];
}

function outline(variant: 'choir' | 'netball', uniqueWord: string): Outline[] {
  const objectives =
    variant === 'choir'
      ? [
          'to promote choral singing in the community;',
          'to hold regular rehearsals and at least two concerts each year;',
          'to welcome singers of every age and ability.',
        ]
      : [
          'to promote netball for players of all ages;',
          'to enter teams in local leagues and tournaments;',
          'to provide safe, fair and friendly play.',
        ];
  const letters = ['a', 'b', 'c', 'd'];
  return [
    {
      refKey: 'part-1',
      kind: 'part',
      number: 'Part 1',
      heading: 'Name and objectives',
      body: '',
      children: [
        { refKey: 's1', kind: 'clause', number: '1', heading: 'Name', body: '' },
        {
          refKey: 'objectives',
          kind: 'clause',
          number: '2',
          heading: 'Objectives',
          body: 'The objectives of the organisation are:',
          children: objectives.map((text, index) => ({
            refKey: `objectives-${letters[index]}`,
            kind: 'subclause' as const,
            number: `(${letters[index]})`,
            heading: null,
            body: text,
          })),
        },
      ],
    },
    {
      refKey: 'part-2',
      kind: 'part',
      number: 'Part 2',
      heading: 'Membership',
      body: '',
      children: [
        { refKey: 's3', kind: 'clause', number: '3', heading: 'Who can join', body: '' },
        {
          refKey: 'leaving',
          kind: 'clause',
          number: '4',
          heading: 'Leaving the organisation',
          body: 'A member may resign at any time by writing to the Secretary. The committee may end a membership only after giving the member a fair chance to be heard.',
        },
        {
          refKey: 'fees',
          kind: 'clause',
          number: '5',
          heading: 'Membership fees',
          body: 'The annual general meeting sets the membership fee. The committee may reduce or waive the fee for anyone facing hardship.',
        },
      ],
    },
    {
      refKey: 'part-3',
      kind: 'part',
      number: 'Part 3',
      heading: 'Meetings and decisions',
      body: '',
      children: [
        {
          refKey: 'agm',
          kind: 'clause',
          number: '6',
          heading: 'Annual general meeting',
          body: 'An annual general meeting must be held every year. Members must receive at least 21 days’ written notice.',
        },
        { refKey: 's2', kind: 'clause', number: '7', heading: 'Quorum', body: '' },
        {
          refKey: 'voting',
          kind: 'clause',
          number: '8',
          heading: 'Voting',
          body: 'Each member has one vote. Decisions are made by a simple majority of members present, unless this constitution says otherwise.',
        },
      ],
    },
    {
      refKey: 'part-4',
      kind: 'part',
      number: 'Part 4',
      heading: 'Money and changes',
      body: '',
      children: [
        {
          refKey: 'finance',
          kind: 'clause',
          number: '9',
          heading: 'Finance',
          body: `The Treasurer keeps the accounts, which are presented at every annual general meeting (${uniqueWord} fund).`,
        },
        {
          refKey: 'amendments',
          kind: 'clause',
          number: '10',
          heading: 'Changing this constitution',
          body: 'This constitution may be changed by a two-thirds majority at a general meeting, if notice of the proposed change was given with the meeting notice.',
        },
      ],
    },
  ];
}

/**
 * Turns the three-clause sample constitution (see sample-tenant.ts) into a fuller document in
 * four parts. Safe to run more than once: it does nothing if the parts already exist.
 */
export async function enrichSampleConstitution(
  db: Database,
  organisationId: string,
  versionId: string,
  variant: 'choir' | 'netball',
  uniqueWord: string,
): Promise<void> {
  const existing = await db
    .select({ id: sections.id, refKey: sections.refKey })
    .from(sections)
    .where(and(eq(sections.organisationId, organisationId), eq(sections.versionId, versionId)));
  const byKey = new Map(existing.map((row) => [row.refKey, row.id]));
  if (byKey.has('part-1')) return;

  let position = 0;
  async function place(item: Outline, parentId: string | null): Promise<void> {
    position += 1;
    const values = {
      parentSectionId: parentId,
      kind: item.kind,
      number: item.number,
      heading: item.heading,
      position,
    };
    let id = byKey.get(item.refKey);
    if (id) {
      // An existing clause (Name, Quorum, Membership): keep its wording, move it into place.
      await db.update(sections).set(values).where(eq(sections.id, id));
    } else {
      const [created] = await db
        .insert(sections)
        .values({ organisationId, versionId, refKey: item.refKey, body: item.body, ...values })
        .returning({ id: sections.id });
      id = created!.id;
    }
    for (const child of item.children ?? []) {
      await place(child, id);
    }
  }
  for (const item of outline(variant, uniqueWord)) {
    await place(item, null);
  }
}
