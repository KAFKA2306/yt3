import yaml
import json
import sys
import os
from datetime import datetime

def load_yaml(path):
    with open(path, 'r') as f:
        return yaml.safe_load(f)

def load_json(path):
    with open(path, 'r') as f:
        return json.load(f)

def calculate():
    # Load configurations
    holdings_config = load_yaml("config/holdings.yaml")
    snapshots_dir = "snapshots/api"
    latest_prices = load_json(os.path.join(snapshots_dir, "prices_latest.json"))

    prices = latest_prices["prices"]
    fx_rate = latest_prices["fx"]["USDJPY"]
    
    total_assets_jpy_t = 0.0
    report_lines = []

    report_lines.append(f"--- SBG NAV Audit Calculation ({datetime.now().isoformat()}) ---")
    report_lines.append(f"FX Rate (USDJPY): {fx_rate}")

    for asset in holdings_config["holdings"]:
        asset_id = asset["asset_id"]
        val_method = asset["valuation_method"]
        
        current_val_jpy_t = 0.0
        
        if val_method == "MARKET_PRICE":
            ticker = asset["ticker"]
            if ticker in prices:
                price = prices[ticker]
                shares = asset.get("shares_owned", 0)
                
                # Check if price is in USD or JPY based on ticker/exchange logic (simplified for now)
                # In a robust system, this would be explicit in tickers.yaml
                if ticker in ["ARM", "TMUS"]:
                    val_usd = price * shares
                    current_val_jpy_t = (val_usd * fx_rate) / 1e12
                else:
                    # JPY tickers
                    # Note: SB_CORP shares not provided by user, using IR valuation as fallback or if share count missing
                    if shares > 0:
                        current_val_jpy_t = (price * shares) / 1e12
                    else:
                        current_val_jpy_t = asset.get("ir_valuation_jpy", 0)
            else:
                # Fallback to IR valuation if price missing (Audit will flag this)
                current_val_jpy_t = asset.get("ir_valuation_jpy", 0)
        
        elif val_method == "IR_FIXED":
            current_val_jpy_t = asset.get("ir_valuation_jpy", 0)

        total_assets_jpy_t += current_val_jpy_t
        report_lines.append(f"Asset: {asset_id:<10} | Method: {val_method:<12} | Value: {current_val_jpy_t:>6.2f} T JPY")

    net_debt_jpy_t = holdings_config["net_debt"]["value_jpy_t"]
    nav_jpy_t = total_assets_jpy_t - net_debt_jpy_t
    
    shares_outstanding_m = holdings_config["ir_benchmarks"]["shares_outstanding_m"]
    nav_per_share = (nav_jpy_t * 1e12) / (shares_outstanding_m * 1e6)
    
    sbg_price = prices.get("9984.T", 0)
    discount = (1 - (sbg_price / nav_per_share)) * 100 if nav_per_share > 0 else 0

    report_lines.append("-" * 50)
    report_lines.append(f"Total Assets:      {total_assets_jpy_t:>10.2f} T JPY")
    report_lines.append(f"Net Debt:          {net_debt_jpy_t:>10.2f} T JPY")
    report_lines.append(f"NAV (Total):       {nav_jpy_t:>10.2f} T JPY")
    report_lines.append(f"NAV per Share:     {nav_per_share:>10.0f} JPY")
    report_lines.append(f"SBG Stock Price:   {sbg_price:>10.0f} JPY")
    report_lines.append(f"Discount Rate:     {discount:>10.2f}%")
    report_lines.append("-" * 50)

    # Output to stdout and save to reports
    report_content = "\n".join(report_lines)
    print(report_content)
    
    out_path = "reports/markdown/latest_nav_calc.md"
    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    with open(out_path, "w") as f:
        f.write(report_content)

if __name__ == "__main__":
    calculate()
