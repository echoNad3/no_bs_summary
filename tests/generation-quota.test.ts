import { describe, expect, it } from 'vitest';
import {
  blockedReason,
  freeQuotaUserKey,
  generationQuotaRequest,
  makeGenerationQuotaStatus,
  normalizeNetworkIdentifier,
} from '../src/generation-quota.js';

describe('generation quota', () => {
  it('reports the daily and monthly pools with their UTC resets', () => {
    const request = generationQuotaRequest(Date.parse('2026-08-23T12:34:56.000Z'), 'a'.repeat(64));
    expect(request).toEqual({
      day: '2026-08-23',
      month: '2026-08',
      userKey: 'a'.repeat(64),
      dailyLimit: 100,
      userLimit: 5,
      globalLimit: 50,
      dailyResetsAt: '2026-08-24T00:00:00.000Z',
      monthlyResetsAt: '2026-09-01T00:00:00.000Z',
    });

    const status = makeGenerationQuotaStatus(12, 3, 12, request);
    expect(status.daily).toMatchObject({ used: 12, limit: 100, remaining: 88 });
    expect(status.free.user).toMatchObject({ used: 3, limit: 5, remaining: 2 });
    expect(status.free.shared).toMatchObject({ used: 12, limit: 50, remaining: 38 });
    expect(blockedReason(status, 'free')).toBeUndefined();
    expect(blockedReason(makeGenerationQuotaStatus(12, 5, 12, request), 'free')).toBe('user');
    expect(blockedReason(makeGenerationQuotaStatus(12, 2, 50, request), 'free')).toBe('global');
    expect(blockedReason(makeGenerationQuotaStatus(100, 2, 12, request), 'owner')).toBe('daily');
  });

  it('groups rotating IPv6 addresses by /64 but keeps IPv4 addresses distinct', () => {
    expect(normalizeNetworkIdentifier('198.51.100.7')).toBe('198.51.100.7');
    expect(normalizeNetworkIdentifier('198.51.100.8')).toBe('198.51.100.8');
    expect(normalizeNetworkIdentifier('2001:db8:abcd:12::1')).toBe('2001:0db8:abcd:0012::/64');
    expect(normalizeNetworkIdentifier('2001:db8:abcd:12:ffff::99')).toBe(
      '2001:0db8:abcd:0012::/64',
    );
  });

  it('creates the same private key for one IPv6 network without exposing the address', async () => {
    const first = await freeQuotaUserKey('2001:db8:abcd:12::1', 'owner-secret');
    const rotated = await freeQuotaUserKey('2001:db8:abcd:12:ffff::99', 'owner-secret');
    const other = await freeQuotaUserKey('2001:db8:abcd:13::1', 'owner-secret');

    expect(first).toMatch(/^[a-f0-9]{64}$/u);
    expect(rotated).toBe(first);
    expect(other).not.toBe(first);
    expect(first).not.toContain('2001');
  });
});
