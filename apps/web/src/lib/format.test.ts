import { describe, expect, it } from 'vitest';
import { actionLabel, formatBytes, formatDuration, statusLabel, statusTone } from './format';

describe('format helpers', () => {
  it('labels and colours statuses consistently', () => {
    expect(statusLabel('trialing')).toBe('Trial');
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
