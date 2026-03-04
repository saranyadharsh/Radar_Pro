"""
Update sector data in Supabase from Yahoo Finance
Run this once to populate correct sector values
"""
import os
import yfinance as yf
from supabase import create_client
from time import sleep

SUPABASE_URL = os.getenv("SUPABASE_URL", "")
SUPABASE_SERVICE_KEY = os.getenv("SUPABASE_SERVICE_KEY", "")

client = create_client(SUPABASE_URL, SUPABASE_SERVICE_KEY)

# Sector mapping from Yahoo Finance to your categories
SECTOR_MAP = {
    "Technology": "TECHNOLOGY",
    "Financial Services": "BANKING",
    "Financials": "BANKING",
    "Healthcare": "BIO",
    "Biotechnology": "BIO",
    "Consumer Cyclical": "CONSUMER",
    "Consumer Defensive": "CONSUMER",
    "Basic Materials": "BM & UENE",
    "Energy": "BM & UENE",
    "Utilities": "BM & UENE",
    "Real Estate": "REALCOM",
    "Communication Services": "REALCOM",
    "Industrials": "INDUSTRY",
    "Industrial": "INDUSTRY",
}

def update_sectors():
    # Get all active tickers
    response = client.table("stock_list").select("ticker").eq("is_active", 1).execute()
    tickers = [row["ticker"] for row in response.data]
    
    print(f"Updating sectors for {len(tickers)} tickers...")
    
    updated = 0
    failed = 0
    
    for i, ticker in enumerate(tickers):
        try:
            stock = yf.Ticker(ticker)
            info = stock.info
            yf_sector = info.get('sector', 'Unknown')
            
            # Map to our sector categories
            our_sector = SECTOR_MAP.get(yf_sector, "INDUSTRY")
            
            # Update in Supabase
            client.table('stock_list').update({
                'sector': our_sector
            }).eq('ticker', ticker).execute()
            
            updated += 1
            if (i + 1) % 10 == 0:
                print(f"Progress: {i + 1}/{len(tickers)} - Last: {ticker} -> {our_sector}")
            
            # Rate limiting
            sleep(0.1)
            
        except Exception as e:
            failed += 1
            print(f"Failed {ticker}: {e}")
            continue
    
    print(f"\nComplete! Updated: {updated}, Failed: {failed}")

if __name__ == "__main__":
    update_sectors()
