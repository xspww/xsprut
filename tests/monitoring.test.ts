import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { formatLastBanwave } from "../src/monitoring/executorStatus";

const YEAR = new Date().getFullYear();

describe("formatLastBanwave", () => {
  it("returns null when there is no banwave mention", () => {
    assert.equal(formatLastBanwave(undefined), null);
    assert.equal(formatLastBanwave(""), null);
    assert.equal(formatLastBanwave("Updated 3 days ago"), null);
  });

  it("formats a single day as DD/MM/YYYY", () => {
    assert.equal(formatLastBanwave("Last banwave: June 1st"), `01/06/${YEAR}`);
    assert.equal(formatLastBanwave("Last banwave: May 26"), `26/05/${YEAR}`);
  });

  it("formats a day range as DD-DD/MM/YYYY", () => {
    assert.equal(formatLastBanwave("Last banwave: March 6-18th"), `06-18/03/${YEAR}`);
  });

  it("passes through unparseable banwave text verbatim", () => {
    assert.equal(formatLastBanwave("Last banwave: soon"), "Last banwave: soon");
  });
});
