const VALID_SEXES = new Set(["male", "female"]);

export function parseLifeTableCsv(csvText) {
  const lines = csvText.trim().split(/\r?\n/);
  const expected = [
    "age",
    "male_mx", "male_qx", "male_lx", "male_dx", "male_ex",
    "female_mx", "female_qx", "female_lx", "female_dx", "female_ex",
  ];
  const headers = lines.shift()?.split(",");
  if (!headers || headers.length !== expected.length || headers.some((name, i) => name !== expected[i])) {
    throw new Error("Life table CSV has missing, unexpected, or reordered columns");
  }

  const rows = lines.filter((line) => line.trim() !== "").map((line, index) => {
    const fields = line.split(",");
    if (fields.length !== headers.length) throw new Error(`Malformed CSV row ${index + 2}`);
    const values = fields.map(Number);
    if (values.some((value) => !Number.isFinite(value))) throw new Error(`Non-numeric value on CSV row ${index + 2}`);
    return Object.fromEntries(headers.map((header, i) => [header, values[i]]));
  });

  if (rows.length < 2) throw new Error("Life table must contain at least two ages");
  for (let i = 0; i < rows.length; i += 1) {
    const row = rows[i];
    if (!Number.isInteger(row.age) || row.age !== i) throw new Error(`Missing, duplicate, or unordered age at row ${i + 2}`);
    for (const sex of VALID_SEXES) {
      for (const field of ["mx", "qx", "lx", "dx", "ex"]) {
        if (row[`${sex}_${field}`] < 0) throw new Error(`Negative ${sex} ${field} at age ${row.age}`);
      }
      if (row[`${sex}_qx`] > 1) throw new Error(`Invalid ${sex} qx at age ${row.age}`);
      if (i > 0 && row[`${sex}_lx`] > rows[i - 1][`${sex}_lx`]) {
        throw new Error(`${sex} lx increases at age ${row.age}`);
      }
    }
  }
  const last = rows.at(-1);
  for (const sex of VALID_SEXES) {
    if (last[`${sex}_lx`] <= 0 || last[`${sex}_ex`] <= 0) {
      throw new Error(`Positive ${sex} lx and ex are required for the terminal-age tail`);
    }
  }
  return rows;
}

function survivorCountAt(rows, sex, age) {
  const lowerAge = Math.floor(age);
  const upperAge = Math.min(lowerAge + 1, rows.length - 1);
  const fraction = age - lowerAge;
  const lower = rows[lowerAge][`${sex}_lx`];
  const upper = rows[upperAge][`${sex}_lx`];
  return lower + (upper - lower) * fraction;
}

export function remainingLifeExpectancy(rows, age, sex) {
  if (!VALID_SEXES.has(sex)) throw new RangeError("Sex must be male or female");
  const finalAge = rows.length - 1;
  if (!Number.isFinite(age) || age < 0 || age > finalAge) {
    throw new RangeError(`Age must be between 0 and ${finalAge}`);
  }

  const startingSurvivors = survivorCountAt(rows, sex, age);
  if (startingSurvivors <= 0) throw new RangeError("No survivors are recorded at the requested age");

  let area = 0;
  for (let interval = Math.floor(age); interval < finalAge; interval += 1) {
    const leftAge = Math.max(age, interval);
    const rightAge = interval + 1;
    const leftLx = survivorCountAt(rows, sex, leftAge);
    const rightLx = rows[rightAge][`${sex}_lx`];
    area += ((leftLx + rightLx) / 2) * (rightAge - leftAge);
  }

  // ONS ex at the final exact age supplies the conditional survival tail beyond the lx series.
  area += rows[finalAge][`${sex}_lx`] * rows[finalAge][`${sex}_ex`];
  return area / startingSurvivors;
}

export function lifeExpectancyResult(rows, age, sex) {
  const remainingYears = remainingLifeExpectancy(rows, age, sex);
  const estimatedAgeAtDeath = age + remainingYears;
  return {
    remainingYears,
    estimatedAgeAtDeath,
    displayedAgeAtDeath: Math.round(estimatedAgeAtDeath),
  };
}