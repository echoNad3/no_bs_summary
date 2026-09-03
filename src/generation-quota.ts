import { DurableObject } from 'cloudflare:workers';

const QUOTA_OBJECT_NAME = 'generation-quota';
const QUOTA_API_ORIGIN = 'https://generation-quota.internal';

export const DEFAULT_DAILY_SUMMARY_LIMIT = 100;
export const DEFAULT_FREE_USER_MONTHLY_LIMIT = 5;
export const DEFAULT_FREE_GLOBAL_MONTHLY_LIMIT = 50;

export interface UsageCounterStatus {
  used: number;
  limit: number;
  remaining: number;
  resetsAt: string;
}

export interface FreeQuotaStatus {
  user: UsageCounterStatus;
  shared: UsageCounterStatus;
}

export interface GenerationQuotaStatus {
  daily: UsageCounterStatus;
  free: FreeQuotaStatus;
}

export type QuotaAccess = 'owner' | 'free';
export type GenerationQuotaBlockReason = 'daily' | 'user' | 'global';

export interface GenerationQuotaDecision {
  allowed: boolean;
  blockedBy?: GenerationQuotaBlockReason;
  status: GenerationQuotaStatus;
}

export interface GenerationQuotaRequest {
  day: string;
  month: string;
  userKey: string;
  dailyLimit: number;
  userLimit: number;
  globalLimit: number;
  dailyResetsAt: string;
  monthlyResetsAt: string;
}

export interface GenerationQuotaClient {
  read(input: GenerationQuotaRequest): Promise<GenerationQuotaStatus>;
  consume(input: GenerationQuotaRequest, access: QuotaAccess): Promise<GenerationQuotaDecision>;
}

export interface GenerationQuotaNamespaceLike {
  getByName(name: string): {
    fetch(request: Request): Promise<Response>;
  };
}

interface GenerationQuotaRpcRequest extends GenerationQuotaRequest {
  action: 'read' | 'consume-owner' | 'consume-free';
}

interface UsageRow {
  used: number;
}

/**
 * One low-traffic SQLite Durable Object coordinates every paid generation.
 * Keeping the daily ceiling and both passwordless monthly ceilings in the
 * same transaction prevents parallel requests or overlapping limits from
 * undercounting usage.
 */
export class GenerationQuota extends DurableObject<WorkerBindings> {
  constructor(ctx: DurableObjectState, env: WorkerBindings) {
    super(ctx, env);
    this.ctx.storage.sql.exec(
      'CREATE TABLE IF NOT EXISTS daily_usage (day TEXT PRIMARY KEY, used INTEGER NOT NULL)',
    );
    this.ctx.storage.sql.exec(
      'CREATE TABLE IF NOT EXISTS global_usage (month TEXT PRIMARY KEY, used INTEGER NOT NULL)',
    );
    this.ctx.storage.sql.exec(
      'CREATE TABLE IF NOT EXISTS user_usage (month TEXT NOT NULL, user_key TEXT NOT NULL, used INTEGER NOT NULL, PRIMARY KEY (month, user_key))',
    );
  }

  override async fetch(request: Request): Promise<Response> {
    if (request.method !== 'POST') return quotaJson(405, { error: 'Method not allowed.' });

    let input: GenerationQuotaRpcRequest;
    try {
      input = (await request.json()) as GenerationQuotaRpcRequest;
    } catch {
      return quotaJson(400, { error: 'Invalid JSON.' });
    }
    if (!isGenerationQuotaRpcRequest(input)) {
      return quotaJson(400, { error: 'Invalid quota request.' });
    }

    const result = this.ctx.storage.transactionSync(() => {
      this.deleteExpiredPeriods(input.day, input.month);
      const current = this.readStatus(input);
      if (input.action === 'read') return current;

      const access: QuotaAccess = input.action === 'consume-owner' ? 'owner' : 'free';
      const blockedBy = blockedReason(current, access);
      if (blockedBy) {
        return {
          allowed: false,
          blockedBy,
          status: current,
        } satisfies GenerationQuotaDecision;
      }

      this.ctx.storage.sql.exec(
        'INSERT INTO daily_usage (day, used) VALUES (?, 1) ON CONFLICT(day) DO UPDATE SET used = used + 1',
        input.day,
      );
      if (access === 'free') {
        this.ctx.storage.sql.exec(
          'INSERT INTO global_usage (month, used) VALUES (?, 1) ON CONFLICT(month) DO UPDATE SET used = used + 1',
          input.month,
        );
        this.ctx.storage.sql.exec(
          'INSERT INTO user_usage (month, user_key, used) VALUES (?, ?, 1) ON CONFLICT(month, user_key) DO UPDATE SET used = used + 1',
          input.month,
          input.userKey,
        );
      }
      return {
        allowed: true,
        status: this.readStatus(input),
      } satisfies GenerationQuotaDecision;
    });

    return quotaJson(200, result);
  }

  private deleteExpiredPeriods(currentDay: string, currentMonth: string): void {
    // A delayed old request must never erase newer counters.
    this.ctx.storage.sql.exec('DELETE FROM daily_usage WHERE day < ?', currentDay);
    this.ctx.storage.sql.exec('DELETE FROM user_usage WHERE month < ?', currentMonth);
    this.ctx.storage.sql.exec('DELETE FROM global_usage WHERE month < ?', currentMonth);
  }

  private readStatus(input: GenerationQuotaRequest): GenerationQuotaStatus {
    const dailyRow = this.ctx.storage.sql
      .exec('SELECT used FROM daily_usage WHERE day = ?', input.day)
      .toArray()[0] as UsageRow | undefined;
    const globalRow = this.ctx.storage.sql
      .exec('SELECT used FROM global_usage WHERE month = ?', input.month)
      .toArray()[0] as UsageRow | undefined;
    const userRow = this.ctx.storage.sql
      .exec(
        'SELECT used FROM user_usage WHERE month = ? AND user_key = ?',
        input.month,
        input.userKey,
      )
      .toArray()[0] as UsageRow | undefined;
    return makeGenerationQuotaStatus(
      dailyRow?.used ?? 0,
      userRow?.used ?? 0,
      globalRow?.used ?? 0,
      input,
    );
  }
}

export class DurableGenerationQuotaClient implements GenerationQuotaClient {
  constructor(private readonly namespace: GenerationQuotaNamespaceLike) {}

  async read(input: GenerationQuotaRequest): Promise<GenerationQuotaStatus> {
    const result = await this.call({ ...input, action: 'read' });
    if (!isGenerationQuotaStatus(result)) {
      throw new Error('The quota service returned invalid status.');
    }
    return result;
  }

  async consume(
    input: GenerationQuotaRequest,
    access: QuotaAccess,
  ): Promise<GenerationQuotaDecision> {
    const result = await this.call({
      ...input,
      action: access === 'owner' ? 'consume-owner' : 'consume-free',
    });
    if (!isGenerationQuotaDecision(result)) {
      throw new Error('The quota service returned an invalid decision.');
    }
    return result;
  }

  private async call(input: GenerationQuotaRpcRequest): Promise<unknown> {
    const stub = this.namespace.getByName(QUOTA_OBJECT_NAME);
    const response = await stub.fetch(
      new Request(`${QUOTA_API_ORIGIN}/${input.action}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(input),
      }),
    );
    if (!response.ok) throw new Error(`The quota service failed (${response.status}).`);
    return response.json();
  }
}

export function generationQuotaRequest(
  now: number,
  userKey: string,
  dailyLimit = DEFAULT_DAILY_SUMMARY_LIMIT,
  userLimit = DEFAULT_FREE_USER_MONTHLY_LIMIT,
  globalLimit = DEFAULT_FREE_GLOBAL_MONTHLY_LIMIT,
): GenerationQuotaRequest {
  const current = new Date(now);
  const dailyReset = new Date(now);
  dailyReset.setUTCHours(24, 0, 0, 0);
  const monthlyReset = new Date(Date.UTC(current.getUTCFullYear(), current.getUTCMonth() + 1, 1));
  return {
    day: current.toISOString().slice(0, 10),
    month: current.toISOString().slice(0, 7),
    userKey,
    dailyLimit,
    userLimit,
    globalLimit,
    dailyResetsAt: dailyReset.toISOString(),
    monthlyResetsAt: monthlyReset.toISOString(),
  };
}

export function makeGenerationQuotaStatus(
  dailyUsed: number,
  userUsed: number,
  globalUsed: number,
  input: Pick<
    GenerationQuotaRequest,
    'dailyLimit' | 'userLimit' | 'globalLimit' | 'dailyResetsAt' | 'monthlyResetsAt'
  >,
): GenerationQuotaStatus {
  return {
    daily: counterStatus(dailyUsed, input.dailyLimit, input.dailyResetsAt),
    free: {
      user: counterStatus(userUsed, input.userLimit, input.monthlyResetsAt),
      shared: counterStatus(globalUsed, input.globalLimit, input.monthlyResetsAt),
    },
  };
}

export function blockedReason(
  status: GenerationQuotaStatus,
  access: QuotaAccess,
): GenerationQuotaBlockReason | undefined {
  if (access === 'free' && status.free.shared.remaining <= 0) return 'global';
  if (access === 'free' && status.free.user.remaining <= 0) return 'user';
  if (status.daily.remaining <= 0) return 'daily';
  return undefined;
}

/** Groups rotating IPv6 client addresses by /64 while keeping IPv4 addresses distinct. */
export function normalizeNetworkIdentifier(address: string | null): string {
  const value = address?.trim().toLowerCase();
  if (!value) return 'missing-client-address';
  if (isIpv4(value)) return value;

  const mappedIpv4 = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/u.exec(value)?.[1];
  if (mappedIpv4 && isIpv4(mappedIpv4)) return mappedIpv4;
  if (!value.includes(':')) return value;

  const halves = value.split('::');
  if (halves.length > 2) return value;
  const left = halves[0] ? halves[0].split(':') : [];
  const right = halves[1] ? halves[1].split(':') : [];
  if (halves.length === 1 && left.length !== 8) return value;
  const missing = halves.length === 2 ? 8 - left.length - right.length : 0;
  if (missing < 0) return value;
  const parts = [...left, ...Array<string>(missing).fill('0'), ...right];
  if (parts.length !== 8 || parts.some((part) => !/^[0-9a-f]{1,4}$/u.test(part))) return value;
  return `${parts
    .slice(0, 4)
    .map((part) => part.padStart(4, '0'))
    .join(':')}::/64`;
}

export async function freeQuotaUserKey(
  clientAddress: string | null,
  secret: string,
): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign(
    'HMAC',
    key,
    encoder.encode(
      `no-bs-summary-generation-quota-v1\0${normalizeNetworkIdentifier(clientAddress)}`,
    ),
  );
  return [...new Uint8Array(signature)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function counterStatus(used: number, limit: number, resetsAt: string): UsageCounterStatus {
  const safeUsed = Number.isInteger(used) && used > 0 ? used : 0;
  return {
    used: safeUsed,
    limit,
    remaining: Math.max(0, limit - safeUsed),
    resetsAt,
  };
}

function isIpv4(value: string): boolean {
  const parts = value.split('.');
  return (
    parts.length === 4 &&
    parts.every((part) => /^\d{1,3}$/u.test(part) && Number(part) >= 0 && Number(part) <= 255)
  );
}

function isGenerationQuotaRpcRequest(value: unknown): value is GenerationQuotaRpcRequest {
  if (!value || typeof value !== 'object') return false;
  const input = value as Partial<GenerationQuotaRpcRequest>;
  return (
    (input.action === 'read' ||
      input.action === 'consume-owner' ||
      input.action === 'consume-free') &&
    isUtcDay(input.day) &&
    isUtcMonth(input.month) &&
    typeof input.userKey === 'string' &&
    /^[a-f0-9]{64}$/u.test(input.userKey) &&
    isPositiveLimit(input.dailyLimit) &&
    isPositiveLimit(input.userLimit) &&
    isPositiveLimit(input.globalLimit) &&
    isTimestamp(input.dailyResetsAt) &&
    isTimestamp(input.monthlyResetsAt)
  );
}

function isPositiveLimit(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 && value <= 100_000;
}

function isGenerationQuotaDecision(value: unknown): value is GenerationQuotaDecision {
  if (!value || typeof value !== 'object') return false;
  const decision = value as Partial<GenerationQuotaDecision>;
  const blockReasonIsValid =
    decision.blockedBy === 'daily' ||
    decision.blockedBy === 'user' ||
    decision.blockedBy === 'global';
  return (
    typeof decision.allowed === 'boolean' &&
    ((decision.allowed && decision.blockedBy === undefined) ||
      (!decision.allowed && blockReasonIsValid)) &&
    isGenerationQuotaStatus(decision.status)
  );
}

function isGenerationQuotaStatus(value: unknown): value is GenerationQuotaStatus {
  if (!value || typeof value !== 'object') return false;
  const status = value as Partial<GenerationQuotaStatus>;
  return (
    isCounterStatus(status.daily) &&
    Boolean(status.free) &&
    isCounterStatus(status.free?.user) &&
    isCounterStatus(status.free?.shared)
  );
}

function isCounterStatus(value: unknown): value is UsageCounterStatus {
  if (!value || typeof value !== 'object') return false;
  const status = value as Partial<UsageCounterStatus>;
  const { used, limit, remaining, resetsAt } = status;
  return (
    typeof used === 'number' &&
    Number.isInteger(used) &&
    used >= 0 &&
    isPositiveLimit(limit) &&
    typeof remaining === 'number' &&
    Number.isInteger(remaining) &&
    remaining === Math.max(0, limit - used) &&
    isTimestamp(resetsAt)
  );
}

function isUtcDay(value: unknown): value is string {
  const timestamp = typeof value === 'string' ? Date.parse(`${value}T00:00:00.000Z`) : Number.NaN;
  return (
    typeof value === 'string' &&
    /^\d{4}-\d{2}-\d{2}$/u.test(value) &&
    Number.isFinite(timestamp) &&
    new Date(timestamp).toISOString().slice(0, 10) === value
  );
}

function isUtcMonth(value: unknown): value is string {
  return typeof value === 'string' && /^\d{4}-(?:0[1-9]|1[0-2])$/u.test(value);
}

function isTimestamp(value: unknown): value is string {
  return typeof value === 'string' && Number.isFinite(Date.parse(value));
}

function quotaJson(status: number, payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}
