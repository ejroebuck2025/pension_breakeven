const finiteNonNegative = (value, label) => {
  if (!Number.isFinite(value) || value < 0) throw new RangeError(`${label} must be a finite non-negative number`);
};

function validateScenario(scenario, currentAge, maximumAge) {
  if (!scenario.id || !scenario.name) throw new TypeError("Each scenario requires an id and name");
  if (!Number.isInteger(scenario.startingAge) || scenario.startingAge < currentAge || scenario.startingAge > maximumAge) {
    throw new RangeError("Starting age must be a whole age between current age and maximum age");
  }
  finiteNonNegative(scenario.grossAnnualPayment, "Gross annual payment");
  finiteNonNegative(scenario.grossLumpSum, "Gross lump sum");
  for (const key of ["paymentTaxRate", "lumpSumTaxRate"]) {
    if (!Number.isFinite(scenario[key]) || scenario[key] < 0 || scenario[key] > 100) {
      throw new RangeError(`${key} must be between 0 and 100`);
    }
  }
}

export function calculateScenario(scenario, { currentAge, maximumAge }) {
  if (!Number.isInteger(currentAge) || currentAge < 0) throw new RangeError("Current age must be a non-negative whole age");
  if (!Number.isInteger(maximumAge) || maximumAge <= currentAge) throw new RangeError("Maximum age must be a whole age later than current age");
  validateScenario(scenario, currentAge, maximumAge);

  const monthCount = (maximumAge - currentAge) * 12;
  const startMonth = (scenario.startingAge - currentAge) * 12;
  const netMonthlyPayment = (scenario.grossAnnualPayment / 12) * (1 - scenario.paymentTaxRate / 100);
  const netLumpSum = scenario.grossLumpSum * (1 - scenario.lumpSumTaxRate / 100);
  const points = [];
  let cumulative = 0;

  for (let month = 0; month <= monthCount; month += 1) {
    if (month === startMonth) cumulative += netLumpSum;
    else if (month > startMonth) cumulative += netMonthlyPayment;
    points.push({ age: currentAge + month / 12, month, cumulative });
  }

  return {
    id: scenario.id,
    name: scenario.name,
    netMonthlyPayment,
    netAnnualPayment: netMonthlyPayment * 12,
    netLumpSum,
    points,
  };
}

export function cumulativeAtAge(result, age) {
  const last = result.points.at(-1);
  if (!Number.isFinite(age) || age < result.points[0].age || age > last.age) {
    throw new RangeError(`Comparison age must be between ${result.points[0].age} and ${last.age}`);
  }
  const monthPosition = (age - result.points[0].age) * 12;
  const lowerMonth = Math.floor(monthPosition + Number.EPSILON);
  const fraction = monthPosition - lowerMonth;
  const lower = result.points[lowerMonth].cumulative;
  const upper = result.points[Math.min(lowerMonth + 1, result.points.length - 1)].cumulative;
  return lower + (upper - lower) * fraction;
}

function meaningfulSign(value, epsilon) {
  if (Math.abs(value) <= epsilon) return 0;
  return Math.sign(value);
}

export function findBreakEvens(first, second, { epsilon = 1e-7 } = {}) {
  if (first.points.length !== second.points.length) throw new Error("Scenario timelines must have equal lengths");
  const differences = first.points.map((point, index) => point.cumulative - second.points[index].cumulative);
  const signs = differences.map((value) => meaningfulSign(value, epsilon));
  const events = [];
  for (let index = 0; index < signs.length;) {
    if (signs[index] === 0) {
      const start = index;
      while (index + 1 < signs.length && signs[index + 1] === 0) index += 1;
      const end = index;
      const before = start > 0 ? signs[start - 1] : 0;
      const after = end + 1 < signs.length ? signs[end + 1] : 0;
      const initialZeroPeriod = start === 0 && first.points[0].cumulative === 0 && second.points[0].cumulative === 0;
      if (!initialZeroPeriod && (before || after)) {
        const midpoint = Math.floor((start + end) / 2);
        const from = before || after;
        const to = after || before;
        events.push({
          type: before && after ? (before === after ? "touch" : "crossover") : "intersection",
          age: (first.points[start].age + first.points[end].age) / 2,
          ...(start !== end ? { equalityInterval: { startAge: first.points[start].age, endAge: first.points[end].age } } : {}),
          amount: (first.points[midpoint].cumulative + second.points[midpoint].cumulative) / 2,
          from: from > 0 ? first.name : second.name,
          to: to > 0 ? first.name : second.name,
          exactSample: true,
        });
      }
    } else if (index + 1 < signs.length && signs[index + 1] !== 0 && signs[index + 1] !== signs[index]) {
      const left = index;
      const right = index + 1;
      const fraction = Math.abs(differences[left]) / (Math.abs(differences[left]) + Math.abs(differences[right]));
      const age = first.points[left].age + (first.points[right].age - first.points[left].age) * fraction;
      events.push({
        type: "crossover",
        age,
        amount: first.points[left].cumulative + (first.points[right].cumulative - first.points[left].cumulative) * fraction,
        from: signs[left] > 0 ? first.name : second.name,
        to: signs[right] > 0 ? first.name : second.name,
        exactSample: false,
      });
    }
    index += 1;
  }

  const nonZeroSigns = signs.filter(Boolean);
  if (nonZeroSigns.length === 0) return { events: [], alwaysEqual: true, leadingBefore: null, leadingAfter: null };
  return {
    events,
    alwaysEqual: false,
    leadingBefore: nonZeroSigns[0] > 0 ? first.name : second.name,
    leadingAfter: nonZeroSigns.at(-1) > 0 ? first.name : second.name,
  };
}

export function compareScenarios(scenarios, settings, comparisonAge) {
  const results = scenarios.map((scenario) => calculateScenario(scenario, settings));
  const values = results.map((result) => ({
    id: result.id,
    name: result.name,
    netLumpSum: result.netLumpSum,
    netMonthlyPayment: result.netMonthlyPayment,
    netAnnualPayment: result.netAnnualPayment,
    cumulativeReceipts: cumulativeAtAge(result, comparisonAge),
    atMaximumAge: result.points.at(-1).cumulative,
    result,
  }));
  const highest = Math.max(...values.map((value) => value.cumulativeReceipts));
  const winners = values.filter((value) => Math.abs(value.cumulativeReceipts - highest) <= 1e-7);
  const breakEvens = [];
  for (let first = 0; first < results.length; first += 1) {
    for (let second = first + 1; second < results.length; second += 1) {
      breakEvens.push({ firstId: results[first].id, secondId: results[second].id, ...findBreakEvens(results[first], results[second]) });
    }
  }
  return { comparisonAge, values, winners: winners.map(({ id, name }) => ({ id, name })), breakEvens };
}