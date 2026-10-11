# Pension Comparison

A standalone WordPress shortcode plugin for illustrative comparisons of cumulative net pension cash receipts.

## Install and Use

1. Upload `pension-comparison.zip` via **Plugins > Add New > Upload Plugin**, or copy the `pension-comparison` directory into `wp-content/plugins/`.
2. Activate **Pension Comparison**.
3. Add `[pension_comparison]` to a page or post.

The plugin uses browser memory only. It does not store or transmit visitor inputs. It has no external runtime dependencies; Chart.js is bundled locally.

Currency display can be changed by WordPress filters:

```php
add_filter('pension_comparison_currency', function () { return 'EUR'; });
add_filter('pension_comparison_locale', function () { return 'de-DE'; });
add_filter('pension_comparison_decimal_precision', function () { return 2; });
```

These settings change display only. They do not convert amounts between currencies.

## Data Source and Updating

The included `data/ons-life-table-gb-2022-2024.csv` was extracted from `data/ons-national-life-tables-gb-1980-2024-source.xlsx`, sheet `2022-2024`. The source workbook describes **National Life Tables, Great Britain**, and identifies the statistics as period life expectancy based on population estimates and deaths by date of registration for three consecutive years. The 2022–2024 period and methodology are documented in the [ONS National Life Tables release](https://www.ons.gov.uk/peoplepopulationandcommunity/birthsdeathsandmarriages/lifeexpectancies/bulletins/nationallifetablesunitedkingdom/2022to2024#data-sources-and-quality).

The tables contain ages 0–100 and male/female `mx`, `qx`, `lx`, `dx`, and `ex`. To update the data, place the replacement official ONS workbook in `assets/data/`, update the selected worksheet name and source description in `scripts/extract_life_table.py` if the release period changed, then run:

```sh
python scripts/extract_life_table.py ../assets/data/nltgb198020223.xlsx data/ons-life-table-gb-2022-2024.csv
npm test
npm run build
```

The extractor checks the expected worksheet, age sequence, required values, non-negative values, and non-increasing survivor counts before writing normalized CSV. The source workbook and Chart.js MIT license are retained in the plugin package for verification and redistribution compliance.

## Calculation Assumptions

- Remaining life expectancy is derived as area under the conditional survival curve `lx(a+t) / lx(a)`. Annual `lx` values are linearly interpolated and integrated with the trapezoidal rule. For ages above the final `lx` point, the tail area is `lx(100) × ex(100)`, using ONS's published period expectancy at age 100. The result is validated against ONS `ex` values and retains full precision internally.
- The life-expectancy display age is rounded to the nearest whole year. Summary calculations and the chart marker use the unrounded estimated age. Estimates use the supplied Great Britain period table and are not predictions for an individual or a forecast of future mortality changes.
- A scenario receives its net lump sum at the start of its starting age. The first net monthly payment arrives one month later. Gross annual payments are divided by 12; payment and lump-sum tax rates are applied independently. The annual chart endpoint includes payments received at that exact age.
- Starting ages before current age are rejected. Cash flows are fixed in nominal terms. No inflation, investment growth, discounting, mortality weighting, future tax changes, or investment value is modelled.
- Cash receipts are interpolated linearly between monthly samples for fractional-age summaries. Break-even detection examines monthly cumulative values, interpolates sign changes, reports exact sampled equality separately, and collapses consecutive equality into an interval. Initial zero-receipt equality is ignored.
- Currency and locale only affect formatting. Display rounding does not change calculations.

## Development and Tests

Requirements: Node.js 18+, npm, and Python 3.8+ for rebuilding the source CSV from XLSX. WordPress requires 6.2+ and PHP 7.4+.

```sh
npm install
npm test
npm run build
php -l pension-comparison.php
```

Tests use Node's built-in test runner; the engine and life-table modules have no runtime npm dependency. The production UI bundle includes Chart.js. For a distributable ZIP, include the plugin PHP file, `assets/`, `data/`, `src/`, and optionally this documentation/test tooling, but exclude `node_modules/`.

## Manual QA Checklist

- Activate in a WordPress installation and add one shortcode, then add two shortcode instances on one page.
- Confirm assets load only on shortcode pages, the plugin behaves under at least two unrelated themes, and no console/network errors occur.
- Exercise edits, tax boundaries, all presets, add/remove third scenario, reset confirmation, tie handling, no-crossing and multiple-crossing cases.
- Test narrow mobile viewport, keyboard-only use, screen-reader access to controls/results/table, reduced-motion preference, and life-expectancy ages inside and outside the chart horizon.
- Confirm currency/locale filters update display without changing underlying numeric calculations.

## Limitations

- The supplied workbook is for Great Britain, whereas the bulletin is titled for the United Kingdom. Results are labelled as Great Britain period-table estimates; country-specific and UK-wide weighting differences are not modelled.
- Life table ages outside 0–100 are unsupported. Life expectancy uses ONS `ex(100)` for the tail beyond the final `lx` age; the result inherits the source table's rounding and period-table limitations.
- Automated browser, WordPress integration, formal accessibility-conformance, and cross-theme tests have not been run in the current environment. The QA list above remains to be completed in a WordPress site.
- This comparison does not determine a universally best pension decision and is not personalised regulated financial advice.