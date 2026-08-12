import sys
import os
import re

def export():
    calc_path = "reports/markdown/latest_nav_calc.md"
    if not os.path.exists(calc_path):
        print("FAIL: No latest_nav_calc.md report found. Run nav:calculate first.")
        sys.exit(1)

    with open(calc_path, "r") as f:
        content = f.read()

    # Create directories
    os.makedirs("reports/csv", exist_ok=True)
    os.makedirs("reports/html", exist_ok=True)

    # 1. Export CSV
    # Extract asset lines
    # Format: Asset: ARM        | Method: MARKET_PRICE | Value:  44.15 T JPY
    asset_pattern = re.compile(r"Asset:\s+(\w+)\s+\|\s+Method:\s+(\w+)\s+\|\s+Value:\s+([\d.]+)\s+T JPY")
    assets = asset_pattern.findall(content)

    csv_lines = ["Asset ID,Valuation Method,Value (T JPY)"]
    for asset in assets:
        csv_lines.append(f"{asset[0]},{asset[1]},{asset[2]}")

    # Add NAV per Share, Discount Rate, etc.
    # NAV (Total):       35.94 T JPY
    # Discount Rate:     32.18%
    nav_match = re.search(r"NAV \(Total\):\s+([\d.]+)\s+T JPY", content)
    discount_match = re.search(r"Discount Rate:\s+([\d.-]+)%", content)

    if nav_match:
        csv_lines.append(f"NAV_TOTAL,calculated,{nav_match.group(1)}")
    if discount_match:
        csv_lines.append(f"DISCOUNT_RATE,calculated,{discount_match.group(1)}")

    with open("reports/csv/sbg_nav_report.csv", "w") as f:
        f.write("\n".join(csv_lines) + "\n")
    print("INFO: CSV report exported to reports/csv/sbg_nav_report.csv")

    # 2. Export HTML
    html_content = f"""<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <title>SBG NAV Audit Executive Report</title>
    <style>
        body {{
            font-family: 'Inter', sans-serif;
            background-color: #0c1020;
            color: #e2e8f0;
            margin: 0;
            padding: 40px;
        }}
        .container {{
            max-width: 800px;
            margin: 0 auto;
            background-color: #151f32;
            padding: 30px;
            border-radius: 12px;
            box-shadow: 0 4px 20px rgba(0, 0, 0, 0.4);
            border: 1px solid #288cfa33;
        }}
        h1 {{
            color: #288cfa;
            border-bottom: 2px solid #288cfa33;
            padding-bottom: 10px;
            margin-top: 0;
        }}
        pre {{
            background-color: #0b0f19;
            padding: 20px;
            border-radius: 8px;
            border: 1px solid #1a2436;
            overflow-x: auto;
            font-family: 'Courier New', Courier, monospace;
            color: #38bdf8;
            font-size: 14px;
            line-height: 1.5;
        }}
        .footer {{
            margin-top: 20px;
            text-align: center;
            font-size: 12px;
            color: #64748b;
        }}
    </style>
</head>
<body>
    <div class="container">
        <h1>SBG NAV Audit Executive Report</h1>
        <pre>{content}</pre>
        <div class="footer">
            SBG NAV Audit System &bull; Zero-Trust Edition
        </div>
    </div>
</body>
</html>
"""
    with open("reports/html/sbg_nav_report.html", "w") as f:
        f.write(html_content)
    print("INFO: HTML report exported to reports/html/sbg_nav_report.html")

if __name__ == "__main__":
    export()

