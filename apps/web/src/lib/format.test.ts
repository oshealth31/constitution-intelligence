import { describe, expect, it } from 'vitest';
import {
  actionLabel,
  describeAuditDetails,
  formatBytes,
  formatDuration,
  statusLabel,
  statusTone,
} from './format';

describe('format helpers', () => {
  it('labels and colours statuses consistently', () => {
    expect(statusLabel('trialing')).toBe('Pilot');
    expect(statusLabel('past_due')).toBe('Past due');
    expect(statusLabel('ok')).toBe('Operational');
    expect(statusTone('suspended')).toBe('critical');
    expect(statusTone('active')).toBe('good');
  });

  it('formats sizes, durations and audit actions', () => {
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(2048)).toBe('2.0 KB');
    expect(formatDuration(90_061)).toBe('1d 1h');
    expect(actionLabel('organisation.status_changed')).toBe('Organisation · status changed');
  });
});

describe('describeAuditDetails', () => {
  it('turns technical audit details into readable lines', () => {
    expect(
      describeAuditDetails({
        from: 'trialing',
        to: 'active',
        reason: 'Customer paid the annual invoice',
        by: 'platform',
        userId: 'hidden',
      }),
    ).toEqual(['Changed from Pilot to Active', 'Reason: Customer paid the annual invoice']);
  });

  it('describes field changes, permissions and counts', () => {
    expect(describeAuditDetails({ changes: { name: { from: 'Old', to: 'New' } } })).toEqual([
      'Name changed from Old to New',
    ]);
    expect(describeAuditDetails({ required: 'platform_super_admin' })).toEqual([
      'Needed: Platform Super Admin',
    ]);
    expect(
      describeAuditDetails({ sessionsRevoked: 2, fields: ['tagline', 'primaryColour'] }),
    ).toEqual(['2 session(s) signed out', 'Fields: tagline, primary colour']);
    expect(describeAuditDetails({ reason: 'wrong_password' })).toEqual(['Reason: wrong password']);
  });

  it('summarises nested values such as subscription changes', () => {
    expect(
      describeAuditDetails({
        to: { planCode: 'standard', status: 'active', currentPeriodEnd: null },
      }),
    ).toEqual(['Changed from none to plan code standard, status Active']);
    expect(describeAuditDetails({})).toEqual([]);
  });
});
