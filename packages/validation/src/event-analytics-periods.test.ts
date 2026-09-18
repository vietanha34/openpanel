import { describe, expect, it } from 'vitest';

import {
  EVENT_ANALYTICS_MAX_PERIODS,
  periodLabel,
  zEventAnalyticsListInput,
  zEventAnalyticsRange,
} from './event-analytics';

const range = {
  projectId: 'p',
  range: '7d' as const,
  filters: [],
};

const listInput = { ...range, sort: 'events', dir: 'desc' as const, limit: 10 };

/**
 * A is first; later entries step back in time. Seven-day periods.
 *
 * Built with Date arithmetic on purpose: subtracting from the day number of a
 * string is the bug the requirements call out (`15 - 21` giving `-6 Sep`), and
 * the first draft of this helper walked straight into it.
 */
const week = (offset: number) => {
  const shift = (day: number) => {
    const date = new Date(Date.UTC(2026, 8, day));
    date.setUTCDate(date.getUTCDate() - 7 * offset);
    return date.toISOString().slice(0, 10);
  };
  return {
    startDate: `${shift(12)} 00:00:00`,
    endDate: `${shift(18)} 23:59:59`,
  };
};

const parse = (periods: unknown) =>
  zEventAnalyticsRange.safeParse({ ...range, periods });

describe('periods on the range schema', () => {
  it('accepts a request with no periods — today’s behaviour', () => {
    expect(zEventAnalyticsRange.safeParse(range).success).toBe(true);
  });

  it('accepts one period', () => {
    expect(parse([week(0)]).success).toBe(true);
  });

  it('accepts the maximum of four', () => {
    expect(
      parse([week(0), week(1), week(2), week(3)]).success,
    ).toBe(true);
    expect(EVENT_ANALYTICS_MAX_PERIODS).toBe(4);
  });

  it('rejects a fifth period', () => {
    expect(
      parse([week(0), week(1), week(2), week(3), week(4)]).success,
    ).toBe(false);
  });

  it('rejects an empty array — absent means one period, not zero', () => {
    expect(parse([]).success).toBe(false);
  });

  it('rejects periods of different lengths (invariant I10)', () => {
    const result = parse([
      week(0),
      { startDate: '2026-09-01 00:00:00', endDate: '2026-09-05 23:59:59' },
    ]);

    expect(result.success).toBe(false);
    expect(JSON.stringify(result)).toMatch(/length/i);
  });

  it('rejects overlapping periods', () => {
    const result = parse([
      week(0),
      { startDate: '2026-09-10 00:00:00', endDate: '2026-09-16 23:59:59' },
    ]);

    expect(result.success).toBe(false);
    expect(JSON.stringify(result)).toMatch(/overlap/i);
  });

  it('rejects a period that ends before it starts', () => {
    expect(
      parse([{ startDate: '2026-09-18 00:00:00', endDate: '2026-09-12 00:00:00' }])
        .success,
    ).toBe(false);
  });

  it('rejects a period whose dates do not parse', () => {
    expect(
      parse([{ startDate: 'yesterday', endDate: 'today' }]).success,
    ).toBe(false);
  });
});

describe('periodLabel', () => {
  it('maps index to the letter the UI shows', () => {
    expect([0, 1, 2, 3].map(periodLabel)).toEqual(['A', 'B', 'C', 'D']);
  });
});

describe('sort with a period suffix', () => {
  const parseList = (input: Record<string, unknown>) =>
    zEventAnalyticsListInput.safeParse({ ...listInput, ...input });

  it('accepts a legacy key with a period suffix', () => {
    expect(parseList({ sort: 'events:B' }).success).toBe(true);
  });

  it('accepts a requested metric key with a period suffix', () => {
    expect(
      parseList({
        metrics: [{ id: 'events' }, { id: 'sum_param', param: 'coins' }],
        sort: 'sum_param:coins:D',
      }).success,
    ).toBe(true);
  });

  it('still rejects a metric that was not requested, suffix or not', () => {
    expect(
      parseList({
        metrics: [{ id: 'events' }],
        sort: 'sum_param:coins:B',
      }).success,
    ).toBe(false);
  });

  it('rejects a suffix that is not a period letter', () => {
    expect(parseList({ sort: 'events:E' }).success).toBe(false);
  });
});
