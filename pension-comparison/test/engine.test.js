import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseLifeTableCsv, remainingLifeExpectancy, lifeExpectancyResult } from "../src/life-table.js";
import { calculateScenario, cumulativeAtAge, compareScenarios, findBreakEvens } from "../src/financial-engine.js";

const dataPath = new URL("../data/ons-life-table-gb-2022-2024.csv", import.meta.url);
const lifeRows = parseLifeTableCsv(readFileSync(fileURLToPath(dataPath), "utf8"));
const settings = { currentAge: 60, maximumAge: 90 };
const scenario = (overrides = {}) => ({
  id: "a", name: "Option A", startingAge: 60, grossAnnualPayment: 12000,
  paymentTaxRate: 20, grossLumpSum: 10000, lumpSumTaxRate: 25, ...overrides,
});

test("ONS table yields published period expectancy values and estimated age", () => {
  assert.ok(Math.abs(remainingLifeExpectancy(lifeRows, 60, "male") - 22.76) < 0.005);
  assert.ok(Math.abs(remainingLifeExpectancy(lifeRows, 60, "female") - 25.46) < 0.005);
  const result = lifeExpectancyResult(lifeRows, 60, "male");
  assert.equal(result.displayedAgeAtDeath, 83);
  assert.equal(result.estimatedAgeAtDeath, 60 + result.remainingYears);
});

test("life table parser rejects unsupported ages, invalid sex, missing ages and increasing lx", () => {
  assert.throws(() => remainingLifeExpectancy(lifeRows, 101, "male"), /between 0 and 100/);
  assert.throws(() => remainingLifeExpectancy(lifeRows, 60, "other"), /male or female/);
  assert.throws(() => parseLifeTableCsv("age,male_lx\n0,100"), /columns/);
  const csvLines = readFileSync(fileURLToPath(dataPath), "utf8").trim().split(/\r?\n/);
  assert.throws(() => parseLifeTableCsv(csvLines.filter((line) => !line.startsWith("2,")).join("\n")), /age/);
  const malformed = "age,male_mx,male_qx,male_lx,male_dx,male_ex,female_mx,female_qx,female_lx,female_dx,female_ex\n0,1,0,100,0,1,1,0,100,0,1\n1,1,0,101,0,1,1,0,99,0,1";
  assert.throws(() => parseLifeTableCsv(malformed), /increases/);
});

test("net payments, lump sum and monthly timing are consistent", () => {
  const result = calculateScenario(scenario(), settings);
  assert.equal(result.netMonthlyPayment, 800);
  assert.equal(result.netAnnualPayment, 9600);
  assert.equal(result.netLumpSum, 7500);
  assert.equal(result.points[0].cumulative, 7500);
  assert.equal(result.points[1].cumulative, 8300);
  assert.equal(result.points[12].cumulative, 7500 + 12 * 800);
  assert.equal(result.points.at(-1).cumulative, 7500 + 360 * 800);
});

test("delayed scenarios receive no prior cash and lump sum exactly once", () => {
  const result = calculateScenario(scenario({ startingAge: 62 }), settings);
  assert.equal(result.points[0].cumulative, 0);
  assert.equal(result.points[23].cumulative, 0);
  assert.equal(result.points[24].cumulative, 7500);
  assert.equal(result.points[25].cumulative, 8300);
});

test("zero cashflows, tax bounds, and invalid input are handled", () => {
  const zero = calculateScenario(scenario({ grossAnnualPayment: 0, grossLumpSum: 0 }), settings);
  assert.equal(zero.points.at(-1).cumulative, 0);
  assert.equal(calculateScenario(scenario({ paymentTaxRate: 0, lumpSumTaxRate: 0 }), settings).netMonthlyPayment, 1000);
  assert.equal(calculateScenario(scenario({ paymentTaxRate: 100, lumpSumTaxRate: 100 }), settings).netLumpSum, 0);
  assert.throws(() => calculateScenario(scenario({ paymentTaxRate: 101 }), settings), /between 0 and 100/);
  assert.throws(() => calculateScenario(scenario({ grossLumpSum: -1 }), settings), /non-negative/);
  assert.throws(() => calculateScenario(scenario({ startingAge: 59 }), settings), /Starting age/);
});

test("comparison interpolates at fractional ages, reports ties and horizon totals", () => {
  const same = scenario({ grossAnnualPayment: 12000, grossLumpSum: 10000 });
  const report = compareScenarios([same, scenario({ ...same, id: "b", name: "Option B" })], settings, 60.5);
  assert.equal(report.values[0].cumulativeReceipts, 7500 + 6 * 800);
  assert.deepEqual(report.winners.map((winner) => winner.name), ["Option A", "Option B"]);
  assert.equal(report.values[0].atMaximumAge, 7500 + 360 * 800);
});

test("break-even detects no crossovers, crossings, equality intervals, and identical lines", () => {
  const makeResult = (name, values) => ({
    name,
    points: values.map((cumulative, month) => ({ age: 60 + month / 12, month, cumulative })),
  });
  const noCross = findBreakEvens(makeResult("A", [0, 1, 2]), makeResult("B", [0, 2, 3]));
  assert.equal(noCross.events.length, 0);
  const cross = findBreakEvens(makeResult("A", [0, 2, 4]), makeResult("B", [0, 4, 2]));
  assert.equal(cross.events.length, 1);
  assert.equal(cross.events[0].type, "crossover");
  assert.ok(Math.abs(cross.events[0].age - (60 + 1.5 / 12)) < 1e-10);
  const multiple = findBreakEvens(makeResult("A", [0, 1, 4, 1, 4]), makeResult("B", [0, 4, 1, 4, 1]));
  assert.equal(multiple.events.length, 3);
  const plateau = findBreakEvens(makeResult("A", [0, 2, 3, 3, 5]), makeResult("B", [0, 4, 3, 3, 2]));
  assert.equal(plateau.events.length, 1);
  assert.deepEqual(plateau.events[0].equalityInterval, { startAge: 60 + 2 / 12, endAge: 60 + 3 / 12 });
  const touch = findBreakEvens(makeResult("A", [0, 2, 3, 5]), makeResult("B", [0, 4, 3, 6]));
  assert.equal(touch.events[0].type, "touch");
  assert.equal(findBreakEvens(makeResult("A", [0, 1]), makeResult("B", [0, 1])).alwaysEqual, true);
});