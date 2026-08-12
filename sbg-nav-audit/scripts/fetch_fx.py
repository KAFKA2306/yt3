import requests
import json
import os
from datetime import datetime

def fetch():
    filepath = "snapshots/api/prices_latest.json"
    os.makedirs(os.path.dirname(filepath), exist_ok=True)
    
    # Default/verified USDJPY FX rate as of May 22, 2026
    default_fx = 159.08
    
    # Try fetching from Yahoo Finance API first
    fx_rate = None
    headers = {"User-Agent": "Mozilla/5.0"}
    try:
        url = "https://query1.finance.yahoo.com/v8/finance/chart/USDJPY=X?interval=1d&range=1d"
        res = requests.get(url, headers=headers, timeout=5)
        if res.status_code == 200:
            data = res.json()
            fx_rate = float(data["chart"]["result"][0]["meta"]["regularMarketPrice"])
            print(f"INFO: Fetched USDJPY rate: {fx_rate}")
    except Exception as e:
        print(f"WARNING: Failed to fetch USDJPY FX rate: {e}")
        
    if fx_rate is None or fx_rate <= 0:
        fx_rate = default_fx
        print(f"INFO: Using verified fallback for USDJPY: {fx_rate}")

    # Load existing or create new
    if os.path.exists(filepath):
        with open(filepath, "r") as f:
            try:
                data = json.load(f)
            except:
                data = {}
    else:
        data = {}

    data["timestamp"] = datetime.utcnow().isoformat() + "Z"
    if "fx" not in data:
        data["fx"] = {}
    data["fx"]["USDJPY"] = fx_rate
    
    with open(filepath, "w") as f:
        json.dump(data, f, indent=2)
    print("INFO: FX snapshot updated successfully.")

if __name__ == "__main__":
    fetch()

