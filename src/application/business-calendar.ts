/** Shop calendar: Madrid civil dates, weekends excluded; regional holidays are not modelled. */
export function deliveryBusinessDate(at: string, days: number) {
  const instant = new Date(at);
  if (!Number.isFinite(instant.getTime())) throw new Error('INVALID_BUSINESS_DATE');
  const parts = new Intl.DateTimeFormat('en', {
    timeZone: 'Europe/Madrid',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(instant);
  const part = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  const date = new Date(Date.UTC(part('year'), part('month') - 1, part('day')));
  let remaining = days;
  while (remaining > 0) {
    date.setUTCDate(date.getUTCDate() + 1);
    if (![0, 6].includes(date.getUTCDay())) remaining--;
  }
  return date.toISOString().slice(0, 10);
}
