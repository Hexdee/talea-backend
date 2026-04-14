const currencyScale = {
  NGN: 100,
  USD: 100,
  USDC: 1_000_000,
} as const;

export function toDisplayAmount(amountInMinor: number, currency: string) {
  const normalized = currency.toUpperCase() as keyof typeof currencyScale;
  const scale = currencyScale[normalized] ?? 100;

  return amountInMinor / scale;
}

export function formatCurrency(amountInMinor: number, currency: string) {
  const normalized = currency.toUpperCase();

  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: normalized === 'USDC' ? 'USD' : normalized,
    currencyDisplay: 'symbol',
    minimumFractionDigits: normalized === 'USDC' ? 2 : 0,
    maximumFractionDigits: normalized === 'USDC' ? 6 : 2,
  }).format(toDisplayAmount(amountInMinor, normalized));
}
