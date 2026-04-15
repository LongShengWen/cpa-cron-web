const CRON_FIELD_RANGES: Array<{ min: number; max: number }> = [
  { min: 0, max: 59 }, // minute
  { min: 0, max: 23 }, // hour
  { min: 1, max: 31 }, // day of month
  { min: 1, max: 12 }, // month
  { min: 0, max: 6 },  // day of week, 0 = Sunday
];

function normalizeCronValue(fieldIndex: number, value: number): number {
  if (fieldIndex === 4 && value === 7) return 0;
  return value;
}

function parseCronNumber(raw: string, fieldIndex: number): number | null {
  if (!/^\d+$/.test(raw)) return null;
  const value = normalizeCronValue(fieldIndex, Number(raw));
  const range = CRON_FIELD_RANGES[fieldIndex];
  if (!Number.isInteger(value) || value < range.min || value > range.max) return null;
  return value;
}

function expandCronSegment(segment: string, fieldIndex: number): Set<number> | null {
  const range = CRON_FIELD_RANGES[fieldIndex];
  const trimmed = segment.trim();
  if (!trimmed) return null;

  const [basePart, stepPart] = trimmed.split('/');
  const step = stepPart == null ? 1 : Number(stepPart);
  if (!Number.isInteger(step) || step < 1) return null;

  let start = range.min;
  let end = range.max;

  if (basePart !== '*') {
    if (basePart.includes('-')) {
      const [rawStart, rawEnd] = basePart.split('-', 2);
      const parsedStart = parseCronNumber(rawStart, fieldIndex);
      const parsedEnd = parseCronNumber(rawEnd, fieldIndex);
      if (parsedStart == null || parsedEnd == null || parsedStart > parsedEnd) return null;
      start = parsedStart;
      end = parsedEnd;
    } else {
      const single = parseCronNumber(basePart, fieldIndex);
      if (single == null) return null;
      start = single;
      end = single;
    }
  }

  const values = new Set<number>();
  for (let value = start; value <= end; value += step) {
    values.add(normalizeCronValue(fieldIndex, value));
  }
  return values;
}

function matchesCronField(value: number, expression: string, fieldIndex: number): boolean {
  const normalizedValue = normalizeCronValue(fieldIndex, value);
  const parts = expression.split(',');
  for (const part of parts) {
    const values = expandCronSegment(part, fieldIndex);
    if (values == null) return false;
    if (values.has(normalizedValue)) return true;
  }
  return false;
}

export function isValidCronExpression(expression: string): boolean {
  const fields = expression.trim().split(/\s+/);
  if (fields.length !== 5) return false;
  return fields.every((field, index) => {
    if (!field.trim()) return false;
    return field.split(',').every((segment) => expandCronSegment(segment, index) != null);
  });
}

export function matchesCronExpression(now: Date, expression: string): boolean {
  if (!isValidCronExpression(expression)) return false;
  const fields = expression.trim().split(/\s+/);
  const utcValues = [
    now.getUTCMinutes(),
    now.getUTCHours(),
    now.getUTCDate(),
    now.getUTCMonth() + 1,
    now.getUTCDay(),
  ];
  return fields.every((field, index) => matchesCronField(utcValues[index], field, index));
}
