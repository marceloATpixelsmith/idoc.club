/**
 * MemberPress stores multi-checkbox profile fields as PHP-serialized arrays, for example
 * `a:2:{s:5:"other";s:2:"on";s:16:"retired-official";s:2:"on";}`. Only the keys whose value is "on" matter, so this reads that one
 * shape and refuses anything else (returns null) rather than guessing.
 *
 * TEMPORARY legacy-import support code: delete with the rest of lib/legacy-import once the migration is finished.
 */
export function checkedKeysFromPhpArray(value: string | null | undefined): string[] | null {
  if (value === null || value === undefined) return null;
  const header = /^a:(\d+):\{/.exec(value);
  if (!header || !value.endsWith('}')) return null;
  const expected = Number(header[1]);
  const body = value.slice(header[0].length, -1);
  const keys: string[] = [];
  let pairs = 0;
  const pairPattern = /s:(\d+):"([^"]*)";s:(\d+):"([^"]*)";/y;
  let index = 0;
  while (index < body.length) {
    pairPattern.lastIndex = index;
    const match = pairPattern.exec(body);
    if (!match || match[2].length !== Number(match[1]) || match[4].length !== Number(match[3])) return null;
    pairs++;
    if (match[4] === 'on') keys.push(match[2]);
    index = pairPattern.lastIndex;
  }
  return pairs === expected ? keys : null;
}
