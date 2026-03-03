"""
migrate_all.py — NexRadar Pro
==============================
Interactive migration tool:
  1. User picks which table to migrate
  2. Shows existing row count in Supabase
  3. Confirms before deleting + re-inserting
  4. Uploads fresh data from Excel

Usage:
  python migrate_all.py
"""

import os

os.environ.pop("SSL_CERT_FILE", None)
import certifi
os.environ["SSL_CERT_FILE"] = certifi.where()

import pandas as pd
from supabase import create_client
import time

# ── Config ────────────────────────────────────────────────────────────────────
SUPABASE_URL         = "https://kbkmwrjobiaiwrvngqgq.supabase.co"
SUPABASE_SERVICE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imtia213cmpvYmlhaXdydm5ncWdxIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MjQ3NTk4NCwiZXhwIjoyMDg4MDUxOTg0fQ.BLn7NPYj5ohGhPAUUIVoax9nWsKG5UrN_Yjh58RV_S0"

BASE_DIR = r"D:\Share_Tracking\Shares"

FILES = {
    "stock_list": os.path.join(BASE_DIR, "Stock_List.xlsx"),
    "monitor":    os.path.join(BASE_DIR, "Monitor.xlsx"),
    "portfolio":  os.path.join(BASE_DIR, "Portfolio.xlsx"),
    "earnings":   os.path.join(BASE_DIR, "Earnings.xlsx"),
}

client = create_client(SUPABASE_URL, SUPABASE_SERVICE_KEY)

# ── Helpers ───────────────────────────────────────────────────────────────────
def find_col(df, *candidates):
    col_map = {c.strip().upper(): c for c in df.columns}
    for c in candidates:
        if c.upper() in col_map:
            return col_map[c.upper()]
    return None

def safe_str(val, fallback=""):
    s = str(val).strip()
    return fallback if s.lower() in ("nan", "none", "") else s

def safe_float(val, fallback=0.0):
    try:
        return float(val)
    except (ValueError, TypeError):
        return fallback

def get_row_count(table):
    try:
        resp = client.table(table).select("*", count="exact").limit(1).execute()
        return resp.count or 0
    except Exception as e:
        print(f"  ⚠️  Could not check count for '{table}': {e}")
        return -1

def delete_all(table, id_col="ticker"):
    """Delete all rows using gt filter on id column (works for all row counts)."""
    try:
        # Delete in chunks to avoid timeouts on large tables
        client.table(table).delete().gte(id_col, "").execute()   # text cols: gte "" = all rows
        client.table(table).delete().lte(id_col, "").execute()   # catch empty string rows too
        print(f"  🗑️  Cleared all rows from '{table}'")
    except Exception as e:
        print(f"  ❌ Failed to delete from '{table}': {e}")
        raise

def upload(table, rows):
    if not rows:
        print(f"  ⚠️  No rows built — check column mapping above")
        return 0
    BATCH = 100
    for i in range(0, len(rows), BATCH):
        batch = rows[i:i + BATCH]
        # upsert handles any rows that survived the delete (e.g. race condition)
        client.table(table).upsert(batch).execute()
        print(f"  ↑  {min(i + BATCH, len(rows))}/{len(rows)} inserted...")
    return len(rows)


# ── Table row builders ────────────────────────────────────────────────────────
def build_stock_list(df):
    ticker_col  = find_col(df, "TICKER", "SYMBOL", "CODE", "STOCK")
    company_col = find_col(df, "COMPANY", "COMPANY NAME", "NAME", "DESCRIPTION")
    sector_col  = find_col(df, "SECTOR", "INDUSTRY", "CATEGORY")
    sub_col     = find_col(df, "SUB_SECTOR", "SUB SECTOR", "SUBSECTOR", "SUB-SECTOR")
    print(f"  Columns → ticker='{ticker_col}'  company='{company_col}'  sector='{sector_col}'  sub='{sub_col}'")

    rows = []
    for _, r in df.iterrows():
        ticker = safe_str(r[ticker_col]) if ticker_col else ""
        if not ticker:
            continue
        rows.append({
            "ticker":       ticker,
            "company_name": safe_str(r[company_col]) if company_col else "",
            "sector":       safe_str(r[sector_col])  if sector_col  else "",
            "sub_sector":   safe_str(r[sub_col])     if sub_col     else "",
            "is_active":    1,
            "last_updated": int(time.time()),
        })
    return rows


def build_monitor(df):
    ticker_col  = find_col(df, "TICKER", "SYMBOL", "CODE", "STOCK")
    company_col = find_col(df, "COMPANY", "COMPANY NAME", "NAME")
    notes_col   = find_col(df, "NOTES", "NOTE", "COMMENT", "REMARKS")
    date_col    = find_col(df, "ADDED DATE", "DATE ADDED", "DATE", "ADDED")
    print(f"  Columns → ticker='{ticker_col}'  company='{company_col}'  notes='{notes_col}'  date='{date_col}'")

    rows = []
    for _, r in df.iterrows():
        ticker = safe_str(r[ticker_col]) if ticker_col else ""
        if not ticker:
            continue
        added_date = int(time.time())
        if date_col:
            try:
                added_date = int(pd.to_datetime(r[date_col]).timestamp())
            except Exception:
                pass
        rows.append({
            "ticker":       ticker,
            "company_name": safe_str(r[company_col]) if company_col else "",
            "added_date":   added_date,
            "notes":        safe_str(r[notes_col])   if notes_col   else "",
        })
    return rows


def build_portfolio(df):
    ticker_col  = find_col(df, "TICKER", "SYMBOL", "CODE", "STOCK")
    company_col = find_col(df, "COMPANY", "COMPANY NAME", "NAME")
    shares_col  = find_col(df, "SHARES", "QTY", "QUANTITY", "UNITS", "HOLDINGS")
    cost_col    = find_col(df, "AVG COST", "AVG_COST", "AVERAGE COST", "COST", "PRICE", "BUY PRICE")
    date_col    = find_col(df, "ADDED DATE", "DATE ADDED", "DATE", "BUY DATE", "PURCHASE DATE")
    notes_col   = find_col(df, "NOTES", "NOTE", "COMMENT", "REMARKS")
    print(f"  Columns → ticker='{ticker_col}'  shares='{shares_col}'  cost='{cost_col}'")

    rows = []
    for _, r in df.iterrows():
        ticker = safe_str(r[ticker_col]) if ticker_col else ""
        if not ticker:
            continue
        added_date = int(time.time())
        if date_col:
            try:
                added_date = int(pd.to_datetime(r[date_col]).timestamp())
            except Exception:
                pass
        rows.append({
            "ticker":       ticker,
            "company_name": safe_str(r[company_col])  if company_col else "",
            "shares":       safe_float(r[shares_col]) if shares_col  else 0.0,
            "avg_cost":     safe_float(r[cost_col])   if cost_col    else 0.0,
            "added_date":   added_date,
            "notes":        safe_str(r[notes_col])    if notes_col   else "",
        })
    return rows


def build_earnings(df):
    ticker_col  = find_col(df, "TICKER", "SYMBOL", "CODE", "STOCK")
    company_col = find_col(df, "COMPANY", "COMPANY NAME", "NAME")
    date_col = find_col(df, "DATE", "EARNINGS DATE", "REPORT DATE", "EARNING_DATE")
    time_col    = find_col(df, "RESULT TIME", "TIME", "EARNINGS TIME", "REPORT TIME", "BMO/AMC")
    print(f"  Columns → ticker='{ticker_col}'  date='{date_col}'  time='{time_col}'")

    rows = []
    for _, r in df.iterrows():
        ticker = safe_str(r[ticker_col]) if ticker_col else ""
        if not ticker:
            continue
        earnings_date = ""
        if date_col:
            try:
                # Attempt to parse the 'EARNING_DATE' column
                val = r[date_col]
                if pd.isna(val):
                    continue
                earnings_date = pd.to_datetime(val).strftime("%Y-%m-%d")
            except Exception:
                earnings_date = str(val)[:10]
        if not earnings_date or earnings_date == "NaT":
            continue
        rows.append({
            "ticker":        ticker,
            "company_name":  safe_str(r[company_col])       if company_col else "",
            "earnings_date": earnings_date,
            "earnings_time": safe_str(r[time_col], "TNS")   if time_col    else "TNS",
            "last_sync":     int(time.time()),
            "source":        "excel",
        })
    return rows


BUILDERS = {
    "stock_list": build_stock_list,
    "monitor":    build_monitor,
    "portfolio":  build_portfolio,
    "earnings":   build_earnings,
}

# earnings uses composite PK (ticker + earnings_date) so delete via date col
DELETE_COL = {
    "stock_list": "ticker",
    "monitor":    "ticker",
    "portfolio":  "ticker",
    "earnings":   "earnings_date",
}


# ── Main interactive flow ─────────────────────────────────────────────────────
def migrate_table(table):
    excel_path = FILES[table]
    print(f"\n{'─' * 60}")
    print(f"  Table  : {table}")
    print(f"  Source : {excel_path}")
    print(f"{'─' * 60}")

    # Check file
    if not os.path.exists(excel_path):
        print(f"  ❌  File not found: {excel_path}")
        print(f"  ⏭️  Skipping '{table}'")
        return

    # Check existing row count
    count = get_row_count(table)
    if count > 0:
        print(f"  ⚠️  '{table}' already has {count} rows in Supabase")
        confirm = input(f"  Delete all {count} rows and re-insert from Excel? (yes/no): ").strip().lower()
        if confirm not in ("yes", "y"):
            print(f"  ⏭️  Skipped '{table}'")
            return
    elif count == 0:
        print(f"  ✅  '{table}' is empty — inserting fresh data")
    else:
        print(f"  ℹ️  Could not verify existing data — proceeding")

    # Load Excel
    print(f"\n  📂  Reading Excel...")
    try:
        df = pd.read_excel(excel_path)
        print(f"  Found {len(df)} rows | Columns: {df.columns.tolist()}")
    except Exception as e:
        print(f"  ❌  Failed to read Excel: {e}")
        return

    # Build rows
    rows = BUILDERS[table](df)
    print(f"  Built {len(rows)} valid rows")

    if not rows:
        print(f"  ⚠️  No valid rows — check column names above. Skipping.")
        return

    # Delete existing
    if count > 0:
        try:
            delete_all(table, id_col=DELETE_COL[table])
        except Exception:
            print(f"  ❌  Aborting '{table}' due to delete failure")
            return

    # Insert fresh
    inserted = upload(table, rows)
    print(f"\n  ✅  '{table}' done — {inserted} rows inserted")


def main():
    print("\n" + "═" * 60)
    print("    NexRadar Pro — Supabase Migration Tool")
    print("═" * 60)
    print("""
  Which table do you want to migrate?

    1  →  stock_list   (Stock_List.xlsx)
    2  →  monitor      (Monitor.xlsx)
    3  →  portfolio    (Portfolio.xlsx)
    4  →  earnings     (Earnings.xlsx)
    5  →  ALL tables
    """)

    choice = input("  Enter choice (1-5): ").strip()

    table_map = {
        "1": ["stock_list"],
        "2": ["monitor"],
        "3": ["portfolio"],
        "4": ["earnings"],
        "5": ["stock_list", "monitor", "portfolio", "earnings"],
    }

    if choice not in table_map:
        print("\n  ❌  Invalid choice. Exiting.")
        return

    for table in table_map[choice]:
        migrate_table(table)

    print(f"\n{'═' * 60}")
    print("  🎉  Migration complete!")
    print(f"{'═' * 60}\n")


if __name__ == "__main__":
    main()