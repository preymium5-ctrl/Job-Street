export const exchangeRateSource = "https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml";
export const exchangeRateSourcePage = "https://www.ecb.europa.eu/stats/policy_and_exchange_rates/euro_reference_exchange_rates/html/eurofxref-graph-php.en.html";

export interface EurPhpRate { rate: number; date: string; }

// Verified against the ECB feed on 16 October 2026. Kept as a dated fallback
// so estimates remain available during a temporary upstream interruption.
export const referenceRate: EurPhpRate = { rate: 70.858, date: "2026-10-16" };

export function parseEcbPhpRate(xml: string): EurPhpRate | undefined {
  const date = xml.match(/<Cube\s+time=['"](\d{4}-\d{2}-\d{2})['"]/i)?.[1];
  const raw = xml.match(/<Cube\s+currency=['"]PHP['"]\s+rate=['"]([\d.]+)['"]/i)?.[1];
  const rate = Number(raw);
  if (!date || !Number.isFinite(Date.parse(date)) || !Number.isFinite(rate) || rate <= 0 || rate > 10000) return;
  return { date, rate };
}

export function phpSalaryRange(salary: string, rate: number): string | undefined {
  const match = salary.match(/^\s*€\s*(\d[\d,]*(?:\.\d+)?)\s*(?:[–—-]\s*€?\s*(\d[\d,]*(?:\.\d+)?))?\s*$/);
  if (!match || !Number.isFinite(rate) || rate <= 0) return;
  const amounts = [match[1], match[2]].filter(Boolean).map((value) => Number(value.replaceAll(",", "")));
  if (amounts.some((value) => !Number.isFinite(value) || value <= 0) || (amounts[1] && amounts[1] < amounts[0])) return;
  const format = new Intl.NumberFormat("en-PH", { maximumFractionDigits: 0 });
  return amounts.map((value) => `₱${format.format(value * rate)}`).join("–");
}
