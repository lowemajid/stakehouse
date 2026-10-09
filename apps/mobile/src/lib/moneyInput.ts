/**
 * Dollar-entry parsing for the create-league form. Money is integer cents in
 * the domain; the form takes a free-text dollar amount and hands the domain a
 * plain integer number of cents. Parsing is intentionally strict — anything
 * ambiguous is rejected rather than guessed.
 */
export function parseDollarsToCents(input: string): number | null {
  const cleaned = input.trim().replace(/^\$/, '').replace(/,/g, '');
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) return null;

  const [wholePart, fractionPart = ''] = cleaned.split('.');
  const whole = Number(wholePart);
  const fraction = Number((fractionPart + '00').slice(0, 2));
  const total = whole * 100 + fraction;
  return Number.isSafeInteger(total) ? total : null;
}
