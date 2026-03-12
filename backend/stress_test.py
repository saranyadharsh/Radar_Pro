import asyncio
import json
import time
import random
from datetime import datetime
# Change TradeSession to MarketSession
from Scalping_Signal import MarketSession, TradeSignal, Signal

# Mock configuration
STRESS_TICKERS = ["AAPL", "TSLA", "NVDA", "AMD", "MSFT", "GOOGL", "META", "AMZN", "NFLX", "PYPL"]
BURST_COUNT = 150  # Total signals to fire

async def run_ui_stress_test(broadcaster):
    """
    Simulates a 'Flash Flood' of signals to test UI responsiveness.
    """
    print(f"🚀 Starting Stress Test: Injecting {BURST_COUNT} signals...")
    
    for i in range(BURST_COUNT):
        symbol = random.choice(STRESS_TICKERS)
        score = random.uniform(0.6, 0.95) * (1 if random.random() > 0.5 else -1)
        
        # Create a mock signal object mirroring Scalping_Signal.py structure
        mock_signal = {
            "type": "trade_signal",
            "data": {
                "symbol": symbol,
                "signal": "STRONG_BUY" if score > 0 else "STRONG_SELL",
                "score": round(score, 3),
                "confidence": 0.92,
                "strength": "STRONG",
                "entry_price": 150.00 + random.uniform(-10, 10),
                "timestamp": datetime.now().isoformat(),
                "reasons": [
                    {"text": "STRESS TEST: Order Block Detected 🐋", "type": "bull"},
                    {"text": "STRESS TEST: Supertrend UP ▲", "type": "bull"}
                ]
            }
        }

        # Inject into your existing broadcaster queue
        await broadcaster.broadcast(mock_signal)
        
        # Randomized micro-delays to simulate high-frequency bursts
        if i % 10 == 0:
            print(f"📡 Injected {i}/{BURST_COUNT} signals...")
            await asyncio.sleep(0.1)  # Brief pause every 10 signals
        else:
            await asyncio.sleep(0.01) # Near-instant injection

    print("✅ Stress Test Complete. Check UI for freezing or lag.")

# To run this, you would wrap it in your main.py startup or a dedicated debug route.