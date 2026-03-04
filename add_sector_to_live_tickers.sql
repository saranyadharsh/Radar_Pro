-- Add sector column to live_tickers table
-- Run this in Supabase SQL Editor

ALTER TABLE live_tickers 
ADD COLUMN IF NOT EXISTS sector TEXT;

-- Create index for sector filtering
CREATE INDEX IF NOT EXISTS idx_live_sector ON live_tickers(sector);

-- Verify the column was added
SELECT column_name, data_type 
FROM information_schema.columns 
WHERE table_name = 'live_tickers' 
ORDER BY ordinal_position;
