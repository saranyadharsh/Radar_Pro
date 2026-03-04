"""
verify_company_names.py
=======================
Quick script to verify company names are in Supabase.
"""

import os
from dotenv import load_dotenv
from pathlib import Path

load_dotenv(Path(__file__).parent / ".env")

from supabase import create_client

SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_SERVICE_KEY = os.getenv("SUPABASE_SERVICE_KEY")

supabase = create_client(SUPABASE_URL, SUPABASE_SERVICE_KEY)

print("=" * 80)
print("Company Name Verification")
print("=" * 80)

# Get sample of tickers
response = supabase.table("stock_list").select("ticker, company_name, sector").eq("is_active", 1).limit(20).execute()

print(f"\nSample of {len(response.data)} tickers:\n")
print(f"{'TICKER':<10} {'COMPANY NAME':<40} {'SECTOR':<15}")
print("-" * 80)

for row in response.data:
    ticker = row['ticker']
    company = row['company_name']
    sector = row.get('sector', 'N/A')
    
    # Check if company name is just the ticker
    status = "⚠️" if company == ticker else "✓"
    
    print(f"{status} {ticker:<10} {company:<40} {sector:<15}")

# Count how many have proper names vs ticker symbols
total_response = supabase.table("stock_list").select("ticker, company_name").eq("is_active", 1).execute()
total = len(total_response.data)
proper_names = sum(1 for r in total_response.data if r['company_name'] != r['ticker'])
ticker_only = total - proper_names

print("\n" + "=" * 80)
print("Summary:")
print("=" * 80)
print(f"Total active tickers: {total}")
print(f"✓ Proper company names: {proper_names} ({proper_names/total*100:.1f}%)")
print(f"⚠️ Ticker symbols only: {ticker_only} ({ticker_only/total*100:.1f}%)")

if ticker_only > 0:
    print(f"\n⚠️  {ticker_only} tickers still need company names updated")
    print("   Run: python update_company_names.py")
else:
    print("\n✓ All tickers have proper company names!")
    print("   Restart backend to load updated names:")
    print("   uvicorn backend.main:app --host 0.0.0.0 --port 8000")
