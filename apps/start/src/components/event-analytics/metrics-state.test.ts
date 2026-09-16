import { EVENT_ANALYTICS_MAX_METRICS } from '@openpanel/validation';
import { describe, expect, it } from 'vitest';

import {
  type MetricsDraft,
  addMetric,
  applyDraft,
  canApply,
  catalogueGroups,
  chipLabel,
  closeParam,
  counterLabel,
  createDraft,
  moveMetric,
  openParam,
  parameterOptions,
  removeMetric,
  setParam,
  toolbarLabel,
} from './metrics-state';

const draftOf = (
  metrics: MetricsDraft['metrics'],
  editing: number | null = null,
): MetricsDraft => ({ metrics, editing });

describe('createDraft', () => {
  it('copies the committed metrics with no dropdown open', () => {
    const committed = [{ id: 'events' as const }, { id: 'users' as const }];
    const draft = createDraft(committed);

    expect(draft).toEqual({ metrics: committed, editing: null });
    expect(draft.metrics).not.toBe(committed);
  });
});

describe('addMetric', () => {
  it('appends a plain metric', () => {
    const next = addMetric(draftOf([{ id: 'events' }]), 'users');

    expect(next.metrics).toEqual([{ id: 'events' }, { id: 'users' }]);
    expect(next.editing).toBeNull();
  });

  it('appends a pending parameter chip and opens its dropdown', () => {
    const next = addMetric(draftOf([{ id: 'events' }]), 'sum_param');

    expect(next.metrics).toEqual([{ id: 'events' }, { id: 'sum_param' }]);
    expect(next.editing).toBe(1);
  });

  it('allows the same parameter metric twice (A5)', () => {
    const next = addMetric(
      draftOf([{ id: 'events' }, { id: 'sum_param', param: 'day' }]),
      'sum_param',
    );

    expect(next.metrics).toEqual([
      { id: 'events' },
      { id: 'sum_param', param: 'day' },
      { id: 'sum_param' },
    ]);
  });

  it('toggles off a plain metric that is already chosen', () => {
    const next = addMetric(
      draftOf([{ id: 'events' }, { id: 'users' }, { id: 'epu' }]),
      'users',
    );

    expect(next.metrics).toEqual([{ id: 'events' }, { id: 'epu' }]);
  });

  it('never toggles off the locked Events metric', () => {
    const draft = draftOf([{ id: 'events' }, { id: 'users' }]);

    expect(addMetric(draft, 'events')).toEqual(draft);
  });

  it('adds nothing once the draft holds the maximum', () => {
    const full = draftOf([
      { id: 'events' },
      ...Array.from({ length: EVENT_ANALYTICS_MAX_METRICS - 1 }, (_, i) => ({
        id: 'sum_param' as const,
        param: `p${i}`,
      })),
    ]);

    expect(addMetric(full, 'users')).toEqual(full);
    expect(addMetric(full, 'sum_param')).toEqual(full);
  });
});

describe('removeMetric', () => {
  it('removes an unlocked metric', () => {
    const next = removeMetric(draftOf([{ id: 'events' }, { id: 'users' }]), 1);

    expect(next.metrics).toEqual([{ id: 'events' }]);
  });

  it('keeps the locked Events metric', () => {
    const draft = draftOf([{ id: 'events' }, { id: 'users' }]);

    expect(removeMetric(draft, 0)).toEqual(draft);
  });

  it('closes the parameter dropdown', () => {
    const next = removeMetric(
      draftOf([{ id: 'events' }, { id: 'users' }, { id: 'sum_param' }], 2),
      1,
    );

    expect(next.editing).toBeNull();
  });
});

describe('moveMetric', () => {
  it('reorders the chips', () => {
    const next = moveMetric(
      draftOf([{ id: 'events' }, { id: 'users' }, { id: 'epu' }]),
      2,
      0,
    );

    expect(next.metrics).toEqual([{ id: 'epu' }, { id: 'events' }, { id: 'users' }]);
  });

  it('closes the parameter dropdown', () => {
    const next = moveMetric(
      draftOf([{ id: 'events' }, { id: 'users' }, { id: 'sum_param' }], 2),
      2,
      0,
    );

    expect(next.editing).toBeNull();
  });

  it('ignores an out-of-range move', () => {
    const draft = draftOf([{ id: 'events' }, { id: 'users' }]);

    expect(moveMetric(draft, 0, 5)).toEqual(draft);
  });
});

describe('parameter step', () => {
  it('sets the parameter and closes the dropdown', () => {
    const next = setParam(draftOf([{ id: 'events' }, { id: 'sum_param' }], 1), 1, 'day');

    expect(next.metrics[1]).toEqual({ id: 'sum_param', param: 'day' });
    expect(next.editing).toBeNull();
  });

  it('reopens the dropdown on an existing parameter chip only', () => {
    const draft = draftOf([{ id: 'events' }, { id: 'sum_param', param: 'day' }]);

    expect(openParam(draft, 1).editing).toBe(1);
    expect(openParam(draft, 0).editing).toBeNull();
  });

  it('closing the dropdown leaves a pending chip in place', () => {
    const next = closeParam(draftOf([{ id: 'events' }, { id: 'sum_param' }], 1));

    expect(next).toEqual(draftOf([{ id: 'events' }, { id: 'sum_param' }]));
  });
});

describe('canApply', () => {
  it('accepts a complete draft', () => {
    expect(
      canApply(draftOf([{ id: 'events' }, { id: 'sum_param', param: 'day' }])),
    ).toBe(true);
  });

  it('rejects a pending parameter chip (A2)', () => {
    expect(canApply(draftOf([{ id: 'events' }, { id: 'sum_param' }]))).toBe(false);
  });

  it('rejects the same metric on the same parameter twice', () => {
    expect(
      canApply(
        draftOf([
          { id: 'events' },
          { id: 'sum_param', param: 'day' },
          { id: 'sum_param', param: 'day' },
        ]),
      ),
    ).toBe(false);
  });
});

describe('applyDraft', () => {
  const sort = { key: 'sum_param:day', dir: 'asc' as const };

  it('keeps a sort that is still a chosen metric', () => {
    const result = applyDraft(
      draftOf([{ id: 'events' }, { id: 'sum_param', param: 'day' }]),
      sort,
    );

    expect(result).toEqual({
      metrics: [{ id: 'events' }, { id: 'sum_param', param: 'day' }],
      sort,
    });
  });

  it('resets the sort to events when its metric was removed', () => {
    const result = applyDraft(draftOf([{ id: 'events' }, { id: 'users' }]), sort);

    expect(result?.sort).toEqual({ key: 'events', dir: 'desc' });
  });

  it('returns null for a draft that cannot be applied', () => {
    expect(applyDraft(draftOf([{ id: 'events' }, { id: 'sum_param' }]), sort)).toBeNull();
  });
});

describe('labels', () => {
  it('labels plain, pending and parameter chips', () => {
    expect(chipLabel({ id: 'users' })).toBe('Users');
    expect(chipLabel({ id: 'sum_param' })).toBe('Sum of parameter values: —');
    expect(chipLabel({ id: 'sum_param', param: 'day' })).toBe(
      'Sum of parameter values: day',
    );
  });

  it('counts the chosen metrics', () => {
    expect(counterLabel(3)).toBe('3 of 10 metrics selected');
  });

  it('names the first metric and the rest as a count', () => {
    expect(toolbarLabel([{ id: 'events' }])).toBe('Metrics · Events');
    expect(toolbarLabel([{ id: 'sum_param', param: 'day' }])).toBe(
      'Metrics · Sum of parameter values',
    );
    expect(toolbarLabel([{ id: 'events' }, { id: 'users' }, { id: 'epu' }])).toBe(
      'Metrics · Events, +2',
    );
  });
});

describe('catalogueGroups', () => {
  it('lists every metric in two titled groups', () => {
    const groups = catalogueGroups('');

    expect(groups.map((group) => group.title)).toEqual([
      'Metrics by events',
      'Metrics by users',
    ]);
    expect(groups.flatMap((group) => group.items).length).toBe(11);
    expect(groups[0]?.items[0]).toMatchObject({
      id: 'events',
      label: 'Events',
      help: 'Total number of events in the period',
    });
  });

  it('filters by label, case-insensitively, and drops empty groups', () => {
    const groups = catalogueGroups('PER USER');

    expect(groups.map((group) => group.title)).toEqual(['Metrics by users']);
    expect(groups[0]?.items.map((item) => item.id)).toEqual([
      'epu',
      'uniq_param_user',
      'sum_param_user',
    ]);
  });
});

describe('parameterOptions', () => {
  const names = [
    'name',
    'properties.day',
    'country',
    'properties.level_id',
    'properties.items[*]',
    'profile.properties.plan',
  ];

  it('keeps event properties only, without the prefix', () => {
    expect(parameterOptions(names, '')).toEqual(['day', 'level_id']);
  });

  it('filters by the search term, case-insensitively', () => {
    expect(parameterOptions(names, ' LEVEL')).toEqual(['level_id']);
  });
});
