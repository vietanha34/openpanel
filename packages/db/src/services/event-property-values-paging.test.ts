import { describe, expect, it, vi } from 'vitest';

import { ch } from '../clickhouse/client';
import {
  type IGetEventPropertyValuesInput,
  OverviewService,
} from './overview.service';

const base: IGetEventPropertyValuesInput = {
  projectId: 'test-event-analytics',
  filters: [],
  startDate: '2026-09-01 00:00:00',
  endDate: '2026-09-02 00:00:00',
  timezone: 'UTC',
  event: 'level_start',
  key: 'level_mode',
  type: 'str',
  parentPath: [],
  sort: 'events',
  dir: 'desc',
  limit: 2,
  cursor: 0,
};

type Row = { value: string; events: string; users: string; total_distinct: string };

function row(value: string, totalDistinct: number): Row {
  return {
    value,
    events: '10',
    users: '4',
    total_distinct: String(totalDistinct),
  };
}

/** Runs the service against a canned ClickHouse result set. */
async function runWith(rows: Row[], input = base) {
  const service = new OverviewService(ch);
  const spy = vi
    .spyOn(ch, 'query')
    .mockResolvedValue({ json: async () => ({ data: rows }) } as never);
  try {
    return await service.getEventPropertyValues(input);
  } finally {
    spy.mockRestore();
  }
}

describe('OverviewService.getEventPropertyValues paging', () => {
  it('drops the probe row and points the cursor past the page', async () => {
    const result = await runWith([
      row('a', 9),
      row('b', 9),
      row('c', 9),
    ]);

    expect(result.rows.map((r) => r.value)).toEqual(['a', 'b']);
    expect(result.nextCursor).toBe(2);
    expect(result.remaining).toBe(7);
  });

  it('continues from a non-zero cursor', async () => {
    const result = await runWith([row('c', 9), row('d', 9), row('e', 9)], {
      ...base,
      cursor: 2,
    });

    expect(result.nextCursor).toBe(4);
    expect(result.remaining).toBe(5);
  });

  it('closes the page when no probe row comes back', async () => {
    const result = await runWith([row('a', 9), row('b', 9)], {
      ...base,
      cursor: 7,
    });

    expect(result.rows).toHaveLength(2);
    expect(result.nextCursor).toBeNull();
    expect(result.remaining).toBe(0);
  });

  it('never reports remaining rows without a cursor to fetch them with', async () => {
    // total_distinct is a separate aggregate and can lag the page; the two
    // must still agree or the UI's "Load more" button does nothing.
    const result = await runWith([row('a', 2), row('b', 2), row('c', 2)]);

    expect(result.nextCursor).not.toBeNull();
    expect(result.remaining).toBeGreaterThan(0);
  });

  it('returns numbers, not ClickHouse strings', async () => {
    const result = await runWith([row('a', 1)]);

    expect(result.rows[0]).toEqual({ value: 'a', events: 10, users: 4 });
  });
});
