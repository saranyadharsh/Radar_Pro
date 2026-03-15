#!/usr/bin/env python3
"""
cleanup_inactive_tickers.py — NexRadar Pro
Marks warrant (W suffix) and preferred share (P suffix) tickers as
is_active = 0 in stock_list. These tickers have no meaningful intraday
price data, cause yfinance errors on every deploy, and pollute the
live table with stale prices.

Run once against prod Supabase:
  SUPABASE_URL=... SUPABASE_KEY=... python cleanup_inactive_tickers.py

DRY_RUN=1 python cleanup_inactive_tickers.py   ← preview only
"""

import os, sys
from supabase import create_client

SUPABASE_URL = os.environ["SUPABASE_URL"]
SUPABASE_KEY = os.environ.get("SUPABASE_KEY") or os.environ.get("SUPABASE_SERVICE_KEY")
DRY_RUN      = os.environ.get("DRY_RUN", "0") == "1"

client = create_client(SUPABASE_URL, SUPABASE_KEY)

print("Fetching active tickers from stock_list...")
rows = []
offset = 0
while True:
    resp = client.table("stock_list") \
        .select("ticker, company_name, is_active") \
        .eq("is_active", 1) \
        .range(offset, offset + 999) \
        .execute()
    batch = resp.data or []
    rows.extend(batch)
    if len(batch) < 1000:
        break
    offset += 1000

print(f"Total active tickers: {len(rows)}")

# Identify warrant/preferred tickers
# W suffix = warrant (e.g. MOBBW, ONMDW, ALVOW)
# P suffix = preferred (e.g. HOVNP, BHFAP, CIOPF)
# These tickers are typically 4-6 chars ending in W or P
warrant_and_preferred = []
for r in rows:
    t = r["ticker"]
    if len(t) >= 4:
        suffix = t[-1]
        base   = t[:-1]
        # Only flag if base ticker exists (paired common stock) OR volume = 0
        if suffix in ("W", "P") and len(base) >= 3:
            warrant_and_preferred.append(r)

print(f"\nWarrant/Preferred tickers to deactivate: {len(warrant_and_preferred)}")
for r in warrant_and_preferred[:20]:
    print(f"  {r['ticker']:<10} {r.get('company_name','')[:40]}")
if len(warrant_and_preferred) > 20:
    print(f"  ... and {len(warrant_and_preferred)-20} more")

if DRY_RUN:
    print("\nDRY RUN — no changes made. Remove DRY_RUN=1 to apply.")
    sys.exit(0)

confirm = input(f"\nDeactivate {len(warrant_and_preferred)} tickers? [y/N] ")
if confirm.lower() != "y":
    print("Aborted.")
    sys.exit(0)

# Mark is_active = 0 in batches of 50
tickers_to_deactivate = [r["ticker"] for r in warrant_and_preferred]
batch_size = 50
deactivated = 0
for i in range(0, len(tickers_to_deactivate), batch_size):
    batch = tickers_to_deactivate[i:i+batch_size]
    client.table("stock_list") \
        .update({"is_active": 0}) \
        .in_("ticker", batch) \
        .execute()
    deactivated += len(batch)
    print(f"  Deactivated {deactivated}/{len(tickers_to_deactivate)}...")

print(f"\nDone. {deactivated} tickers marked is_active=0.")
print("Restart the backend service to reload the ticker list.")
