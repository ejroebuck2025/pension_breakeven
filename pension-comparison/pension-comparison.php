<?php
/**
 * Plugin Name: Pension Comparison
 * Description: An illustrative comparison of cumulative net pension receipts.
 * Version: 1.0.0
 * Requires at least: 6.2
 * Requires PHP: 7.4
 * Text Domain: pension-comparison
 */

if (!defined('ABSPATH')) {
	exit;
}

final class Pension_Comparison_Plugin {
	const VERSION = '1.0.0';

	public function __construct() {
		add_shortcode('pension_comparison', array($this, 'render_shortcode'));
		add_action('wp_enqueue_scripts', array($this, 'register_assets'));
	}

	public function register_assets() {
		$base = plugin_dir_url(__FILE__);
		$path = plugin_dir_path(__FILE__);
		wp_register_style('pension-comparison', $base . 'assets/css/app.css', array(), filemtime($path . 'assets/css/app.css'));
		wp_register_script('pension-comparison-app', $base . 'assets/js/app.bundle.js', array(), filemtime($path . 'assets/js/app.bundle.js'), true);
		global $post;
		if ($post instanceof WP_Post && has_shortcode($post->post_content, 'pension_comparison')) {
			wp_enqueue_style('pension-comparison');
			wp_enqueue_script('pension-comparison-app');
		}
	}

	public function render_shortcode() {
		wp_enqueue_script('pension-comparison-app');

		$currency = apply_filters('pension_comparison_currency', 'GBP');
		$locale = apply_filters('pension_comparison_locale', 'en-GB');
		$precision = apply_filters('pension_comparison_decimal_precision', 2);
		$id = wp_unique_id('pension-comparison-');

		ob_start();
		?>
		<section id="<?php echo esc_attr($id); ?>" class="pc-app" data-currency="<?php echo esc_attr($currency); ?>" data-locale="<?php echo esc_attr($locale); ?>" data-precision="<?php echo esc_attr((string) max(0, min(4, (int) $precision))); ?>" data-life-table="<?php echo esc_url(plugin_dir_url(__FILE__) . 'data/ons-life-table-gb-2022-2024.csv'); ?>" aria-labelledby="<?php echo esc_attr($id); ?>-title">
			<header class="pc-header">
				<div><p class="pc-kicker">PENSION PLANNING / ILLUSTRATIVE TOOL</p><h2 id="<?php echo esc_attr($id); ?>-title">Compare your options</h2></div>
			</header>
			<div class="pc-toolbar">
				<label>Example scenarios <select class="pc-preset"><option value="">Choose an example</option><option value="lump">Larger lump sum / lower payments</option><option value="timing">Earlier or later start</option><option value="balanced">Different payment levels</option></select></label>
				<div class="pc-actions"><button type="button" class="pc-add">+ Add scenario</button><button type="button" class="pc-reset">Reset</button></div>
			</div>
			<div class="pc-assumptions">
				<h3>Personal assumptions <span>Illustrative defaults</span></h3>
				<div class="pc-assumption-fields">
					<label>Current age <input class="pc-current-age" type="number" min="0" max="100" step="1" value="60" inputmode="numeric"></label>
					<label>Gender <select class="pc-sex"><option value="">Select gender</option><option value="male">Male</option><option value="female">Female</option></select></label>
					<label>Currency <select class="pc-currency"><option value="GBP" <?php selected($currency, 'GBP'); ?>>GBP (£)</option><option value="USD" <?php selected($currency, 'USD'); ?>>USD ($)</option><option value="EUR" <?php selected($currency, 'EUR'); ?>>EUR (€)</option></select></label>
					<label>Chart through age <input class="pc-max-age" type="number" min="61" max="120" step="1" value="100" inputmode="numeric"></label>
					<div class="pc-life-result" aria-live="polite"><span>Remaining life expectancy</span><strong class="pc-remaining">Calculating</strong><small>Estimated age at death: <b class="pc-death-age">Calculating</b></small></div>
				</div>
			</div>
			<div class="pc-scenarios" aria-label="Pension scenarios"></div>
			<p class="pc-error" role="alert" hidden></p>
			<section class="pc-chart-section" aria-labelledby="<?php echo esc_attr($id); ?>-chart-title">
				<div class="pc-section-heading"><div><p class="pc-kicker">CUMULATIVE NET RECEIPTS</p><h3 id="<?php echo esc_attr($id); ?>-chart-title">Total income received over time</h3></div></div>
				<div class="pc-chart-wrap"><canvas class="pc-chart" role="img" aria-label="Interactive chart comparing cumulative net receipts by age"></canvas></div>
				<details class="pc-data-table"><summary>View annual chart data</summary><div class="pc-table-scroll"><table><caption>Annual cumulative net receipts by scenario</caption><thead></thead><tbody></tbody></table></div></details>
			</section>
			<section class="pc-results" aria-labelledby="<?php echo esc_attr($id); ?>-results-title"><div class="pc-section-heading"><div><p class="pc-kicker">AT YOUR LIFE EXPECTANCY</p><h3 id="<?php echo esc_attr($id); ?>-results-title">Cumulative comparison</h3></div><p class="pc-result-age"></p></div><div class="pc-winner" aria-live="polite"></div><div class="pc-result-grid"></div></section>
			<footer class="pc-footer">Payments and tax rates modelled are fixed in nominal terms and do not adjust for inflation. Life expectancy calculated from the ONS 2022–2024 Great Britain period life table. For illustrative purposes only and not financial advice or a personal recommendation.</footer>
		</section>
		<?php
		return ob_get_clean();
	}
}

new Pension_Comparison_Plugin();