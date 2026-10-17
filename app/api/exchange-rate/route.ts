import { exchangeRateSource, parseEcbPhpRate, referenceRate } from "@/lib/exchange-rate";

export async function GET() {
  try {
    const response = await fetch(exchangeRateSource, { next: { revalidate: 3600 }, signal: AbortSignal.timeout(5000) });
    if (!response.ok) throw new Error("RATE_UNAVAILABLE");
    const latest = parseEcbPhpRate(await response.text());
    if (!latest) throw new Error("RATE_INVALID");
    return Response.json(latest, { headers: { "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=86400" } });
  } catch {
    return Response.json(referenceRate, { headers: { "Cache-Control": "public, s-maxage=300" } });
  }
}
