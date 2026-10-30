const usdFormat = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });

export const formatUsd = (cents: number) => usdFormat.format(cents / 100);

export const formatHa = (ha: number) => `${ha.toLocaleString('en-US', { maximumFractionDigits: 2 })} ha`;
