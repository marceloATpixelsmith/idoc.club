//NORMALIZE BOTH THE VISIBLE DD/MM/YYYY FORMAT AND THE ISO VALUES SUBMITTED BY DATE PICKERS.
//VALIDATE THE ACTUAL CALENDAR DAY BEFORE PERSISTING ANY VALUE.
export function normalizeSeminarDate(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  const isoMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(trimmed);
  const displayMatch = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(trimmed);
  if (!isoMatch && !displayMatch) return null;

  const year = Number(isoMatch?.[1] ?? displayMatch?.[3]);
  const month = Number(isoMatch?.[2] ?? displayMatch?.[2]);
  const day = Number(isoMatch?.[3] ?? displayMatch?.[1]);
  if (year < 1000 || month < 1 || month > 12 || day < 1 || day > 31) return null;

  const iso = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  const date = new Date(`${iso}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== iso) return null;
  return iso;
}
