import assert from 'node:assert/strict';
import test from 'node:test';
import { getFiltersStateParser } from '../lib/parsers.ts';

test('saved single-value status filters adopt Is and Is not without changing which status they match', () => {
  const parser = getFiltersStateParser(['status'], { status: 'select' });
  for (const [operator, expected] of [['inArray', 'eq'], ['notInArray', 'ne']] as const) {
    const parsed = parser.parse(JSON.stringify([{ filterId: 'saved', id: 'status', operator, value: ['active'], variant: 'multiSelect' }]));
    assert.deepEqual(parsed, [{ filterId: 'saved', id: 'status', operator: expected, value: 'active', variant: 'select' }]);
  }
});

test('saved multi-value status filters retain their existing union or exclusion meaning', () => {
  const parser = getFiltersStateParser(['status'], { status: 'select' });
  const previous = [{ filterId: 'saved', id: 'status', operator: 'inArray', value: ['active', 'expired'], variant: 'multiSelect' }];
  assert.deepEqual(parser.parse(JSON.stringify(previous)), previous);
});

test('a cleared select value leaves other filter rows intact after URL parsing', () => {
  const parser = getFiltersStateParser(['status', 'country'], { status: 'select', country: 'select' });
  const filters = [
    { filterId: 'status-row', id: 'status', operator: 'eq', value: '', variant: 'select' },
    { filterId: 'country-row', id: 'country', operator: 'eq', value: 'DE', variant: 'select' },
  ] as const;
  assert.deepEqual(parser.parse(JSON.stringify(filters)), filters);
});
