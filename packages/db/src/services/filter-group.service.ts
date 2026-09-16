import type { IChartEventFilter, IFilterGroup } from '@openpanel/validation';

type CompileFilter = (filter: IChartEventFilter) => string | null;

/**
 * Wrap each fragment and the whole list. The redundant outer parentheses cost
 * nothing in ClickHouse and make it impossible for an OR inside a fragment to
 * rebind against the surrounding AND.
 */
function joinFragments(
  fragments: string[],
  op: 'and' | 'or',
): string | null {
  if (fragments.length === 0) {
    return null;
  }

  const separator = op === 'and' ? ' AND ' : ' OR ';
  return `(${fragments.map((fragment) => `(${fragment})`).join(separator)})`;
}

/**
 * Compile an AND/OR condition tree into one WHERE-clause fragment.
 *
 * A condition that compiles to null is DROPPED, and a group left with no
 * surviving children returns null — "no restriction", never `1 = 0`. Inside an
 * AND a drop narrows nothing; inside an OR it widens, which is why the UI
 * refuses to save a condition that cannot compile. The only drops left are
 * filters structurally inapplicable to the table being queried.
 */
export function compileFilterGroup(
  group: IFilterGroup,
  compile: CompileFilter,
): string | null {
  const fragments: string[] = [];

  for (const child of group.children) {
    if (child.kind === 'condition') {
      const clause = compile(child.filter);
      if (clause) {
        fragments.push(clause);
      }
      continue;
    }

    const nested = child.children
      .map((nestedChild) => compile(nestedChild.filter))
      .filter((clause): clause is string => clause !== null);

    const subGroup = joinFragments(nested, child.op);
    if (subGroup) {
      fragments.push(subGroup);
    }
  }

  return joinFragments(fragments, group.op);
}

/**
 * The group's clause in the shape `createSqlBuilder().sb.where` expects. One key
 * is enough: callers already merge the record's values with AND, so no caller
 * needs to learn about grouping.
 */
export function getFilterGroupWhere(
  group: IFilterGroup,
  compile: CompileFilter,
): Record<string, string> {
  const clause = compileFilterGroup(group, compile);
  return clause ? { fgroup: clause } : {};
}
