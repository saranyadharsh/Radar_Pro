"""
update_company_names.py
========================
Updates company names in Supabase stock_list table from Yahoo Finance.
Run this script to populate proper company names instead of ticker symbols.

Usage:
    python update_company_names.py
"""

import os
import time
from dotenv import load_dotenv
from pathlib import Path

# Load environment variables
load_dotenv(Path(__file__).parent / ".env")

import yfinance as yf
from supabase import create_client

# Supabase credentials
SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_SERVICE_KEY = os.getenv("SUPABASE_SERVICE_KEY")

if not SUPABASE_URL or not SUPABASE_SERVICE_KEY:
    raise RuntimeError("SUPABASE_URL and SUPABASE_SERVICE_KEY must be set in .env file")

# Initialize Supabase client
supabase = create_client(SUPABASE_URL, SUPABASE_SERVICE_KEY)

def get_company_name(ticker: str) -> str:
    """
    Fetch company name from Yahoo Finance.
    Returns longName, shortName, or ticker as fallback.
    """
    try:
        stock = yf.Ticker(ticker)
        info = stock.info
        
        # Try longName first, then shortName, then ticker
        company_name = (
            info.get("longName") or 
            info.get("shortName") or 
            ticker
        )
        
        return company_name
    except Exception as e:
        print(f"  ⚠ Error fetching {ticker}: {e}")
        return ticker

def update_all_company_names():
    """
    Update company names for all active tickers in stock_list.
    """
    print("=" * 60)
    print("Company Name Updater")
    print("=" * 60)
    
    # Get all active tickers
    print("\n📊 Fetching tickers from Supabase...")
    response = supabase.table("stock_list").select("ticker").eq("is_active", 1).execute()
    tickers = [r["ticker"] for r in response.data]
    
    print(f"✓ Found {len(tickers)} active tickers\n")
    
    # Update each ticker
    success_count = 0
    error_count = 0
    
    for i, ticker in enumerate(tickers, 1):
        try:
            # Fetch company name from Yahoo Finance
            company_name = get_company_name(ticker)
            
            # Update in Supabase
            supabase.table("stock_list").update({
                "company_name": company_name
            }).eq("ticker", ticker).execute()
            
            # Print progress
            status = "✓" if company_name != ticker else "→"
            print(f"{status} [{i}/{len(tickers)}] {ticker:6s} → {company_name}")
            success_count += 1
            
            # Rate limiting (Yahoo Finance has limits)
            if i % 10 == 0:
                time.sleep(1)  # Pause every 10 requests
                
        except Exception as e:
            print(f"✗ [{i}/{len(tickers)}] {ticker:6s} → ERROR: {e}")
            error_count += 1
    
    # Summary
    print("\n" + "=" * 60)
    print("Update Complete")
    print("=" * 60)
    print(f"✓ Success: {success_count}")
    print(f"✗ Errors:  {error_count}")
    print(f"📊 Total:   {len(tickers)}")
    print("\n💡 Restart backend to load updated company names:")
    print("   uvicorn backend.main:app --host 0.0.0.0 --port 8000")

def update_specific_tickers(tickers: list):
    """
    Update company names for specific tickers only.
    Useful for testing or fixing specific entries.
    """
    print(f"\n📊 Updating {len(tickers)} specific tickers...\n")
    
    for ticker in tickers:
        try:
            company_name = get_company_name(ticker)
            
            supabase.table("stock_list").update({
                "company_name": company_name
            }).eq("ticker", ticker).execute()
            
            print(f"✓ {ticker:6s} → {company_name}")
            
        except Exception as e:
            print(f"✗ {ticker:6s} → ERROR: {e}")

if __name__ == "__main__":
    import sys
    
    # Check if specific tickers provided as arguments
    if len(sys.argv) > 1:
        # Update specific tickers
        tickers = sys.argv[1:]
        print(f"\n🎯 Updating specific tickers: {', '.join(tickers)}")
        update_specific_tickers(tickers)
    else:
        # Update all tickers
        print("\n🌐 Updating ALL active tickers...")
        print("⚠️  This will take several minutes due to rate limiting.")
        print("⚠️  Press Ctrl+C to cancel.\n")
        
        try:
            input("Press Enter to continue...")
        except KeyboardInterrupt:
            print("\n\n❌ Cancelled by user")
            sys.exit(0)
        
        update_all_company_names()
