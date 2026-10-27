import assert from 'node:assert/strict';
import test from 'node:test';

test('findLast and findLastIndex are defined for browsers that lack them, and behave like the built-ins', async () => {
  const proto = Array.prototype as unknown as Record<string, unknown>;
  const savedFindLast = proto.findLast; const savedFindLastIndex = proto.findLastIndex;
  delete proto.findLast; delete proto.findLastIndex;
  try {
    await import('../lib/browser/array-polyfills.ts');
    const list = [1, 2, 3, 4, 5, 6];
    assert.equal(list.findLast((value) => value % 2 === 1), 5);
    assert.equal(list.findLastIndex((value) => value % 2 === 1), 4);
    assert.equal(list.findLast((value) => value > 10), undefined);
    assert.equal(list.findLastIndex((value) => value > 10), -1);
    assert.equal(([] as number[]).findLast(() => true), undefined);
    assert.deepEqual(Object.keys(list), ['0', '1', '2', '3', '4', '5'], 'the polyfill is not enumerable');
  } finally { proto.findLast = savedFindLast; proto.findLastIndex = savedFindLastIndex; }
});
