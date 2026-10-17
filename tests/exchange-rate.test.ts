import assert from "node:assert/strict";
import { test } from "node:test";
import { parseEcbPhpRate, phpSalaryRange, referenceRate } from "../lib/exchange-rate";

test("PHP salary estimates handle EUR ranges, rounding and invalid compensation formats", () => {
  assert.equal(phpSalaryRange("€900–€1,200", referenceRate.rate), "₱63,772–₱85,030");
  assert.equal(phpSalaryRange("€850–1,100", 70), "₱59,500–₱77,000");
  assert.equal(phpSalaryRange("€1,000", 70), "₱70,000");
  for (const salary of ["To be confirmed", "$1,000–$2,000", "€2,000–€1,000", "€0", "€900 per hour"])
    assert.equal(phpSalaryRange(salary, 70), undefined);
  for (const rate of [0, -1, Number.NaN, Number.POSITIVE_INFINITY])
    assert.equal(phpSalaryRange("€900–€1,200", rate), undefined);
});

test("ECB parsing selects PHP and preserves the reference date without treating other currencies as pesos", () => {
  const xml = `<Cube><Cube time='2026-10-16'><Cube currency='USD' rate='1.2'/><Cube currency='PHP' rate='70.858'/></Cube></Cube>`;
  assert.deepEqual(parseEcbPhpRate(xml), referenceRate);
  assert.deepEqual(parseEcbPhpRate(xml.replaceAll("'", '"')), referenceRate);
  assert.equal(parseEcbPhpRate(xml.replace("currency='PHP'", "currency='CHF'")), undefined);
  assert.equal(parseEcbPhpRate(xml.replace("70.858", "0")), undefined);
  assert.equal(parseEcbPhpRate(xml.replace("2026-10-16", "not-a-date")), undefined);
});
