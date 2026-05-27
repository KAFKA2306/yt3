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

def run_audit():
    # Load configs and results
    holdings_config = load_yaml("config/holdings.yaml")
    thresholds = load_yaml("config/thresholds.yaml")
    latest_prices = load_json("snapshots/api/prices_latest.json")
    
    # Check if calculation report exists
    calc_report_path = "reports/markdown/latest_nav_calc.md"
    if not os.path.exists(calc_report_path):
        print("FAIL: No calculation report found. Run nav:calculate first.")
        sys.exit(1)

    audit_results = []
    audit_results.append(f"--- SBG NAV Zero-Trust Audit Report ({datetime.now().isoformat()}) ---")
    
    overall_pass = True

    # 1. Source Provenance Check
    source = latest_prices.get("source", "UNKNOWN")
    if source == "UNKNOWN":
        audit_results.append("[FAIL] Source Provenance: Data source is UNKNOWN")
        overall_pass = False
    else:
        audit_results.append(f"[PASS] Source Provenance: Data verified via {source}")

    # 2. Stale Data Check
    timestamp_str = latest_prices.get("timestamp", "")
    try:
        data_time = datetime.fromisoformat(timestamp_str.replace("Z", "+00:00"))
        delta = datetime.now(data_time.tzinfo) - data_time
        if delta.total_seconds() > 86400: # 24 hours
            audit_results.append(f"[FAIL] Data Freshness: Data is {delta.total_seconds()/3600:.1f} hours old")
            overall_pass = False
        else:
            audit_results.append(f"[PASS] Data Freshness: Data is {delta.total_seconds()/3600:.1f} hours old")
    except:
        audit_results.append("[FAIL] Data Freshness: Invalid timestamp format")
        overall_pass = False

    # 3. FX Anomaly Check
    fx_val = latest_prices["fx"]["USDJPY"]
    ir_fx = holdings_config["metadata"]["ir_usd_jpy"]
    fx_delta = abs(fx_val - ir_fx) / ir_fx
    if fx_delta > thresholds["anomalies"]["fx_delta_limit"]:
        audit_results.append(f"[FAIL] FX Anomaly: FX Delta {fx_delta:.2%} exceeds limit {thresholds['anomalies']['fx_delta_limit']:.2%}")
        overall_pass = False
    else:
        audit_results.append(f"[PASS] FX Anomaly: FX Delta {fx_delta:.2%} is within limits")

    # 4. Net Debt Consistency
    ir_net_debt = holdings_config["net_debt"]["value_jpy_t"]
    if ir_net_debt <= 0:
        audit_results.append("[FAIL] Net Debt: Debt value is negative or zero (Suspicious)")
        overall_pass = False
    else:
        audit_results.append(f"[PASS] Net Debt: {ir_net_debt} T JPY verified")

    # 5. Missing Ticker Check
    missing_tickers = []
    for asset in holdings_config["holdings"]:
        if asset["valuation_method"] == "MARKET_PRICE":
            ticker = asset.get("ticker")
            if ticker not in latest_prices["prices"]:
                # Note: SB_CORP shares missing but price is in latest_prices?
                # Actually, our config has SB_CORP ticker 9434.T, let's see if it's in prices_latest.json
                if ticker not in latest_prices["prices"]:
                     missing_tickers.append(ticker)
    
    if missing_tickers:
        audit_results.append(f"[FAIL] Missing Tickers: {', '.join(missing_tickers)}")
        overall_pass = False
    else:
        audit_results.append("[PASS] Market Price Coverage: All active tickers present")

    # Final Verdict
    audit_results.append("-" * 50)
    if overall_pass:
        audit_results.append("FINAL VERDICT: PASS (Zero-Trust Verified)")
    else:
        audit_results.append("FINAL VERDICT: FAIL (Audit Issues Detected)")
    audit_results.append("-" * 50)

    # Output and Save
    report_content = "\n".join(audit_results)
    print(report_content)
    
    out_path = "audit/results/latest_audit.txt"
    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    with open(out_path, "w") as f:
        f.write(report_content)

if __name__ == "__main__":
    run_audit()
