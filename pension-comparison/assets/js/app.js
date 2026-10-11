import { compareScenarios, cumulativeAtAge } from "../../src/financial-engine.js";
import { parseLifeTableCsv, lifeExpectancyResult } from "../../src/life-table.js";
import Chart from "chart.js/auto";

const DEFAULT_SCENARIOS = [
  { id: "a", name: "Option A", startingAge: 60, grossAnnualPayment: 12000, paymentTaxRate: 20, grossLumpSum: 50000, lumpSumTaxRate: 25 },
  { id: "b", name: "Option B", startingAge: 60, grossAnnualPayment: 18000, paymentTaxRate: 20, grossLumpSum: 20000, lumpSumTaxRate: 25 },
];
const resetScenario = (id) => ({
  id,
  name: `Scenario ${id.toUpperCase()}`,
  startingAge: 67,
  grossAnnualPayment: 0,
  paymentTaxRate: 0,
  grossLumpSum: 0,
  lumpSumTaxRate: 0,
});
const RESET_SCENARIOS = [resetScenario("a"), resetScenario("b")];
const PRESETS = {
  lump: [
    { ...DEFAULT_SCENARIOS[0], grossAnnualPayment: 9000, grossLumpSum: 65000 },
    { ...DEFAULT_SCENARIOS[1], grossAnnualPayment: 16000, grossLumpSum: 18000 },
  ],
  timing: [
    { ...DEFAULT_SCENARIOS[0], startingAge: 60 },
    { ...DEFAULT_SCENARIOS[1], startingAge: 65 },
  ],
  balanced: [
    { ...DEFAULT_SCENARIOS[0], grossAnnualPayment: 10000, grossLumpSum: 40000 },
    { ...DEFAULT_SCENARIOS[1], grossAnnualPayment: 14000, grossLumpSum: 25000 },
  ],
};

const clone = (value) => JSON.parse(JSON.stringify(value));
const element = (tag, className, text) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};

function mount(root, lifeRows) {
  const defaultCurrency = root.dataset.currency || "GBP";
  let currency = defaultCurrency;
  const locale = root.dataset.locale || "en-GB";
  const digits = Number(root.dataset.precision || 2);
  let money;
  let currencySymbol;
  function setCurrency(code) {
    currency = code;
    money = new Intl.NumberFormat(locale, { style: "currency", currency, currencyDisplay: "narrowSymbol", minimumFractionDigits: digits, maximumFractionDigits: digits });
    currencySymbol = money.formatToParts(0).find((part) => part.type === "currency")?.value || currency;
  }
  setCurrency(currency);
  const number = new Intl.NumberFormat(locale, { maximumFractionDigits: 1 });
  const themeStyle = getComputedStyle(root);
  const colors = ["--pc-scenario-a", "--pc-scenario-b", "--pc-scenario-c"].map((token) => themeStyle.getPropertyValue(token).trim());
  const currencySelect = root.querySelector(".pc-currency");
  if (![...currencySelect.options].some((option) => option.value === currency)) {
    const option = element("option", "", currency);
    option.value = currency;
    currencySelect.add(option, 0);
  }
  currencySelect.value = currency;
  const state = { currentAge: 60, sex: "male", maximumAge: 100, scenarios: clone(DEFAULT_SCENARIOS), chart: null, dirty: false };
  const scenariosNode = root.querySelector(".pc-scenarios");
  const errorNode = root.querySelector(".pc-error");
  const tableHead = root.querySelector(".pc-data-table thead");
  const tableBody = root.querySelector(".pc-data-table tbody");
  const chartCanvas = root.querySelector(".pc-chart");
  const removalObserver = new MutationObserver(() => {
    if (!root.isConnected) {
      if (state.chart) state.chart.destroy();
      state.chart = null;
      removalObserver.disconnect();
    }
  });
  removalObserver.observe(document.documentElement, { childList: true, subtree: true });

  function inputField(label, key, type, value, options = {}) {
    const wrapper = element("label", options.className || "");
    wrapper.append(document.createTextNode(label));
    let input;
    if (type === "currency") {
      input = element("div", "pc-currency-input");
      input.append(element("span", "", currencySymbol));
      const control = element("input");
      control.type = "number";
      control.min = "0";
      control.step = "0.01";
      control.inputMode = "decimal";
      control.value = value;
      control.dataset.key = key;
      input.append(control);
    } else {
      input = element("input");
      input.type = type;
      input.value = value;
      input.dataset.key = key;
      if (type === "number") {
        input.min = options.min ?? "0";
        input.max = options.max ?? "100";
        input.step = options.step ?? "1";
        input.inputMode = options.inputMode || "numeric";
      }
    }
    wrapper.append(input);
    return wrapper;
  }

  function renderScenarioCards() {
    scenariosNode.replaceChildren();
    state.scenarios.forEach((scenario, index) => {
      const card = element("article", "pc-scenario");
      card.style.setProperty("--pc-scenario-color", colors[index]);
      card.dataset.scenarioId = scenario.id;
      const header = element("div", "pc-scenario-head");
      header.append(element("h3", "", `Scenario ${String.fromCharCode(65 + index)}`));
      if (index > 1) {
        const remove = element("button", "pc-remove", "Remove");
        remove.type = "button";
        remove.dataset.action = "remove";
        header.append(remove);
      }
      card.append(header);
      const fields = element("div", "pc-scenario-fields");
      fields.append(inputField("Scenario Name", "name", "text", scenario.name, { className: "pc-name" }));
      fields.append(inputField("Gross Annual Payment", "grossAnnualPayment", "currency", scenario.grossAnnualPayment));
      fields.append(inputField("Tax on Payments (%)", "paymentTaxRate", "number", scenario.paymentTaxRate, { min: "0", max: "100", step: "0.1" }));
      fields.append(inputField("Gross Lump Sum", "grossLumpSum", "currency", scenario.grossLumpSum));
      fields.append(inputField("Tax on Lump Sum (%)", "lumpSumTaxRate", "number", scenario.lumpSumTaxRate, { min: "0", max: "100", step: "0.1" }));
      fields.append(inputField("Payment Starts at Age", "startingAge", "number", scenario.startingAge, { min: state.currentAge, max: state.maximumAge, className: "pc-starting-age" }));
      card.append(fields);
      scenariosNode.append(card);
    });
    root.querySelector(".pc-add").hidden = state.scenarios.length >= 3;
  }

  function updateTable(results) {
    tableHead.replaceChildren();
    tableBody.replaceChildren();
    const headingRow = element("tr");
    headingRow.append(element("th", "", "Age"));
    results.values.forEach((result) => headingRow.append(element("th", "", result.name)));
    tableHead.append(headingRow);
    const firstAge = state.currentAge;
    const lastAge = state.maximumAge;
    for (let age = firstAge; age <= lastAge; age += 1) {
      const row = element("tr");
      row.append(element("th", "", String(age)));
      results.values.forEach((result) => row.append(element("td", "", money.format(cumulativeAtAge(result.result, age)))));
      tableBody.append(row);
    }
  }

  function drawChart(results, expectancyAge) {
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const datasets = results.values.map((item, index) => ({
      label: item.name,
      data: item.result.points.filter((point) => point.age <= state.maximumAge).map((point) => ({ x: point.age, y: point.cumulative })),
      borderColor: colors[index],
      backgroundColor: colors[index],
      borderWidth: 2.5,
      pointRadius: 0,
      pointHitRadius: 9,
      tension: 0,
    }));
    if (state.chart) state.chart.destroy();
    state.chart = new Chart(chartCanvas, {
      type: "line", data: { datasets },
      options: {
        responsive: true, maintainAspectRatio: false,
        animation: reducedMotion ? false : { duration: 220 },
        interaction: { mode: "index", intersect: false },
        plugins: {
          legend: { position: "bottom", labels: { usePointStyle: true, boxWidth: 9 } },
          tooltip: { callbacks: { title: (items) => `Age ${number.format(items[0].parsed.x)}`, label: (item) => `${item.dataset.label}: ${money.format(item.parsed.y)}` } },
        },
        scales: {
          x: { type: "linear", min: state.currentAge, max: state.maximumAge, title: { display: true, text: "Age (years)" }, ticks: { stepSize: state.maximumAge - state.currentAge > 40 ? 5 : undefined, callback: (value) => number.format(value) } },
          y: { beginAtZero: true, title: { display: true, text: `Cumulative net receipts (${currency})` }, ticks: { callback: (value) => new Intl.NumberFormat(locale, { notation: "compact", maximumFractionDigits: 1 }).format(value) } },
        },
      },
      plugins: [{
        id: "pcLifeExpectancyMarker",
        afterDraw(chart) {
          if (!Number.isFinite(expectancyAge) || expectancyAge < state.currentAge || expectancyAge > state.maximumAge) return;
          const x = chart.scales.x.getPixelForValue(expectancyAge);
          const ctx = chart.ctx;
          ctx.save(); ctx.setLineDash([5, 4]); ctx.strokeStyle = colors[0]; ctx.lineWidth = 1.5;
          ctx.beginPath(); ctx.moveTo(x, chart.chartArea.top); ctx.lineTo(x, chart.chartArea.bottom); ctx.stroke();
          ctx.setLineDash([]); ctx.fillStyle = colors[0]; ctx.font = `600 11px ${getComputedStyle(root).fontFamily}`;
          const markerLabel = `Life expectancy: age ${number.format(Math.round(expectancyAge))}`;
          const labelX = x > chart.chartArea.right - 150 ? x - 145 : x + 5;
          ctx.fillText(markerLabel, labelX, chart.chartArea.top + 13); ctx.restore();
        },
      }],
    });
  }

  function update() {
    try {
      errorNode.hidden = true;
      const ageInput = root.querySelector(".pc-current-age").value;
      const maxAgeInput = root.querySelector(".pc-max-age").value;
      const sex = root.querySelector(".pc-sex").value;
      if (ageInput === "") throw new RangeError("Enter your current age.");
      if (maxAgeInput === "") throw new RangeError("Enter the chart end age.");
      if (sex === "") throw new RangeError("Select a gender.");
      const age = Number(ageInput);
      const maxAge = Number(maxAgeInput);
      if (!Number.isInteger(age) || age < 0 || age > 100) throw new RangeError("Current age must be a whole age supported by the ONS table (0–100).");
      if (!Number.isInteger(maxAge) || maxAge <= age || maxAge > 120) throw new RangeError("Chart age must be a whole age later than current age and no greater than 120.");
      state.currentAge = age;
      state.maximumAge = maxAge;
      state.sex = sex;
      for (const scenario of state.scenarios) {
        if (!scenario.name) throw new RangeError("Enter a name for each scenario.");
        if (scenario.startingAge === "") throw new RangeError(`Enter a starting age for ${scenario.name}.`);
        for (const [key, label] of [["grossAnnualPayment", "gross annual payment"], ["paymentTaxRate", "payment tax rate"], ["grossLumpSum", "gross lump sum"], ["lumpSumTaxRate", "lump sum tax rate"]]) {
          if (scenario[key] === "") throw new RangeError(`Enter the ${label} for ${scenario.name}.`);
        }
      }
      const life = lifeExpectancyResult(lifeRows, age, sex);
      root.querySelector(".pc-remaining").textContent = `${number.format(life.remainingYears)} years`;
      root.querySelector(".pc-death-age").textContent = `age ${number.format(life.displayedAgeAtDeath)}`;
      root.querySelector(".pc-result-age").textContent = `Life expectancy age: ${number.format(life.estimatedAgeAtDeath)} years (rounded to Age ${number.format(life.displayedAgeAtDeath)}).`;
      const calculationMaximum = Math.max(maxAge, Math.ceil(life.estimatedAgeAtDeath));
      const results = compareScenarios(state.scenarios, { currentAge: age, maximumAge: calculationMaximum }, life.estimatedAgeAtDeath);
      const winnerText = results.winners.length > 1
        ? `At your life expectancy (Age ${number.format(life.displayedAgeAtDeath)}), ${results.winners.map((winner) => winner.name).join(" and ")} are tied for the highest cumulative net receipts.`
        : (() => {
            const leader = results.values.find((item) => item.id === results.winners[0].id);
            const differences = results.values.filter((item) => item.id !== leader.id)
              .map((item) => `${money.format(leader.cumulativeReceipts - item.cumulativeReceipts)} more than ${item.name}`);
            return `At your life expectancy (Age ${number.format(life.displayedAgeAtDeath)}), ${leader.name} has the highest cumulative net receipts: ${money.format(leader.cumulativeReceipts)}, or ${differences.join(" and ")}.`;
          })();
      root.querySelector(".pc-winner").textContent = winnerText;
      const grid = root.querySelector(".pc-result-grid");
      grid.replaceChildren();
      results.values.forEach((item, index) => {
        const card = element("article", "pc-result");
        card.style.setProperty("--pc-scenario-color", colors[index]);
        card.append(element("h4", "", item.name));
        const dl = element("dl");
        for (const [label, value] of [["Net lump sum", money.format(item.netLumpSum)], ["Net monthly payment", money.format(item.netMonthlyPayment)], ["Net annual payment", money.format(item.netAnnualPayment)], ["At life expectancy", money.format(item.cumulativeReceipts)], [`At chart age ${maxAge}`, money.format(cumulativeAtAge(item.result, maxAge))]]) {
          dl.append(element("dt", "", label), element("dd", "", value));
        }
        card.append(dl); grid.append(card);
      });
      const clipped = {
        ...results,
        values: results.values.map((item) => ({ ...item, result: { ...item.result, points: item.result.points.filter((point) => point.age <= maxAge) } })),
      };
      updateTable(clipped);
      drawChart(clipped, life.estimatedAgeAtDeath);
      if (life.estimatedAgeAtDeath > maxAge) {
        root.querySelector(".pc-result-age").textContent += ` The age marker is outside the chart range ending at ${maxAge}; summary calculations extend to the estimated age.`;
      }
    } catch (error) {
      errorNode.textContent = error.message;
      errorNode.hidden = false;
      root.querySelector(".pc-remaining").textContent = "-";
      root.querySelector(".pc-death-age").textContent = "-";
      root.querySelector(".pc-result-age").textContent = "";
      root.querySelector(".pc-winner").textContent = "";
      root.querySelector(".pc-result-grid").replaceChildren();
      tableHead.replaceChildren();
      tableBody.replaceChildren();
      if (state.chart) { state.chart.destroy(); state.chart = null; }
    }
  }

  function readScenarioInputs() {
    scenariosNode.querySelectorAll(".pc-scenario").forEach((card) => {
      const scenario = state.scenarios.find((item) => item.id === card.dataset.scenarioId);
      card.querySelectorAll("[data-key]").forEach((input) => {
        const key = input.dataset.key;
        scenario[key] = key === "name" ? input.value.trim() : input.value === "" ? "" : Number(input.value);
      });
    });
  }

  root.addEventListener("input", (event) => {
    if (!event.target.matches("[data-key], .pc-current-age, .pc-max-age")) return;
    if (event.target.matches("[data-key]")) readScenarioInputs();
    state.dirty = true;
    update();
  });
  root.addEventListener("change", (event) => {
    if (event.target.matches(".pc-sex")) { state.dirty = true; update(); }
    if (event.target.matches(".pc-currency")) {
      setCurrency(event.target.value);
      renderScenarioCards();
      update();
    }
    if (event.target.matches(".pc-preset")) {
      const preset = PRESETS[event.target.value];
      if (!preset) return;
      if (state.dirty && !window.confirm("Replace the current scenario values with this illustrative example?")) { event.target.value = ""; return; }
      state.scenarios = clone(preset).map((scenario) => ({ ...scenario, startingAge: Math.max(Number(root.querySelector(".pc-current-age").value), scenario.startingAge) }));
      renderScenarioCards(); update(); state.dirty = false;
    }
  });
  root.addEventListener("click", (event) => {
    if (event.target.closest(".pc-add")) {
      if (state.scenarios.length < 3) {
        state.scenarios.push(resetScenario("c"));
        renderScenarioCards(); update(); state.dirty = true;
      }
    } else if (event.target.closest(".pc-remove")) {
      state.scenarios = state.scenarios.filter((scenario) => scenario.id !== "c"); renderScenarioCards(); update(); state.dirty = true;
    } else if (event.target.closest(".pc-reset")) {
      if (state.dirty && !window.confirm("Reset all assumptions and scenarios?")) return;
      state.currentAge = 60; state.maximumAge = 100; state.sex = "male"; state.scenarios = clone(RESET_SCENARIOS); state.dirty = false;
      currencySelect.value = defaultCurrency; setCurrency(defaultCurrency);
      root.querySelector(".pc-current-age").value = "60"; root.querySelector(".pc-max-age").value = "100"; root.querySelector(".pc-sex").value = "male"; root.querySelector(".pc-preset").value = "";
      renderScenarioCards(); update();
    }
  });

  renderScenarioCards();
  update();
}

document.querySelectorAll(".pc-app").forEach(async (root) => {
  try {
    const response = await fetch(root.dataset.lifeTable, { credentials: "same-origin" });
    if (!response.ok) throw new Error("The ONS life table could not be loaded.");
    mount(root, parseLifeTableCsv(await response.text()));
  } catch (error) {
    const alert = root.querySelector(".pc-error");
    alert.textContent = error.message;
    alert.hidden = false;
  }
});