"use client";

import { useEffect, useState } from "react";
import { exchangeRateSourcePage, phpSalaryRange, referenceRate, type EurPhpRate } from "@/lib/exchange-rate";

let sharedRequest: { expires: number; promise: Promise<EurPhpRate> } | undefined;
function currentRate() {
  if (!sharedRequest || sharedRequest.expires < Date.now()) {
    sharedRequest = {
      expires: Date.now() + 3600000,
      promise: fetch("/api/exchange-rate").then(async (response) => {
        if (!response.ok) return referenceRate;
        const value = await response.json();
        return typeof value.rate === "number" && Number.isFinite(value.rate) && value.rate > 0 && /^\d{4}-\d{2}-\d{2}$/.test(value.date)
          ? value as EurPhpRate : referenceRate;
      }).catch(() => referenceRate),
    };
  }
  return sharedRequest.promise;
}

export function SalaryConversion({ salary }: { salary: string }) {
  const [exchange, setExchange] = useState(referenceRate);
  useEffect(() => {
    let active = true;
    currentRate().then((rate) => { if (active) setExchange(rate); });
    return () => { active = false; };
  }, []);
  const converted = phpSalaryRange(salary, exchange.rate);
  if (!converted) return null;
  const date = new Intl.DateTimeFormat("en-PH", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(`${exchange.date}T00:00:00Z`));
  return (
    <div className="salary-conversion">
      <span className="salary-conversion-amount">≈ {converted} <small>PHP / month</small></span>
      <a href={exchangeRateSourcePage} target="_blank" rel="noopener noreferrer" className="salary-conversion-rate">
        Estimate · €1 = ₱{exchange.rate.toFixed(3)} · ECB {date}
      </a>
    </div>
  );
}
