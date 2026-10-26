---
name: solana-skill
description: "Analyze Solana tokens, launchpads, candlestick patterns, volume, and technical indicators. Use when the user asks about Solana memecoins, pump.fun or other launchpads, chart patterns, volume analysis, RSI, MACD, or trading setups on Solana."
type: workflow
lifecycle: active
---

# Solana Skill — Token & Chart Analysis

Specialized analysis for Solana tokens, especially those launched on popular platforms, combined with technical analysis (candlesticks, volume, indicators).

## When to Use

- Questions about Solana tokens, memecoins, or new launches
- Analysis of pump.fun, Moonshot, Raydium, or other Solana launchpads
- Candlestick pattern identification and interpretation
- Volume, liquidity, and on-chain indicator review
- Trading setup evaluation involving RSI, MACD, moving averages, etc. on Solana charts

## Core Workflow

1. **Identify the asset and context**
   - Extract token name, ticker, contract address, or launchpad (pump.fun, etc.).
   - Determine if it's a new launch, established token, or general pattern question.
   - Note relevant timeframes (1m, 5m, 15m, 1h, 4h, 1d) commonly used for Solana memecoins.

2. **Gather data**
   - If the user provides a chart image, description, or specific numbers (price, volume, market cap), use that.
   - When possible, search for current token info, liquidity, holders, or recent activity.
   - For launchpad tokens, note bonding curve status, migration to Raydium/Jupiter, and early volume characteristics.

3. **Analyze candlestick patterns**
   Check for and interpret common patterns:

   | Pattern | Appearance | Typical Meaning | Solana Context Notes |
   |---------|------------|-----------------|----------------------|
   | Doji | Open ≈ Close | Indecision | Often seen at local tops/bottoms on low liquidity |
   | Hammer / Hanging Man | Small body, long lower wick | Potential reversal | Stronger with volume confirmation |
   | Engulfing (Bullish/Bearish) | Second candle engulfs prior | Strong reversal signal | Watch for fakeouts on memecoins |
   | Marubozu | Long body, little/no wick | Strong momentum | Common during pump phases |
   | Three White Soldiers / Black Crows | Three consecutive strong candles | Trend continuation | High volume required for reliability |
   | Shooting Star | Small body, long upper wick | Bearish reversal | Frequent on new Solana launches |

4. **Evaluate volume and liquidity**
   - Compare current volume to recent average and to market cap.
   - Note volume spikes on breakouts vs. divergences (price up, volume down).
   - For launchpads: early high volume relative to market cap is typical; watch for volume dry-up after bonding curve completion.
   - Flag extremely thin liquidity (high slippage risk).

5. **Apply key indicators**
   Review when data is available:

   | Indicator | What to Watch | Common Solana Usage |
   |-----------|---------------|---------------------|
   | RSI (14) | >70 overbought, <30 oversold | Short-term extremes on 5m–15m charts |
   | MACD | Crosses and histogram | Momentum shifts after initial pumps |
   | Moving Averages (9/21/50 EMA) | Price vs. EMAs, crossovers | Trend direction on higher timeframes |
   | Volume Profile / VWAP | High-volume nodes | Support/resistance on established tokens |
   | On-chain (holders, top wallets) | Concentration, new holders | Risk of dumps from early wallets |

6. **Structure the response**
   ```
   ## Token / Setup Overview
   [Brief context: launchpad, market cap stage, timeframe]

   ## Candlestick & Price Action
   - Pattern(s) identified and interpretation

   ## Volume & Liquidity
   - Volume characteristics and implications

   ## Indicators
   - Relevant readings and signals

   ## Risk Notes
   - Specific risks for this type of Solana token (rug potential, low liquidity, etc.)

   ## Summary Bias
   - Bullish / Bearish / Neutral with key conditions
   ```

## Platform Analysis Tools

Use these primary sources for Solana trend analysis. Always cross-reference multiple platforms.

### DexScreener (dexscreener.com/solana)
- **Primary use**: Charting, volume, liquidity, and trending discovery for tokens that have graduated from launchpads.
- **Trending signals**: Volume, number of transactions, unique makers, liquidity depth, price change, social/trust signals.
- **Typical patterns observed**:
  - Top trending tokens are often <24 hours old with extreme short-term moves (+100% to +8000% in hours).
  - High volume relative to liquidity is common (elevated slippage risk).
  - Meme/novelty themes dominate (animals, AI/bots, celebrity references, absurd names).
  - SOL is the most common quote asset; many pairs use PumpSwap or Raydium pools post-graduation.
- **Practical checks**:
  - Compare 5m / 1h / 6h / 24h volume and price change.
  - Note liquidity vs. 24h volume ratio — very low liquidity + high volume = high risk.
  - Watch for Dex Paid / Boost activity (visibility plays); success is mixed.
  - After Pump.fun graduation, a token appears on DexScreener once it has a liquidity pool and at least one trade.

### Jupiter (jup.ag)
- **Primary use**: Best execution routing, organic vs. wash volume assessment, and broader discovery.
- **Key features for analysis**:
  - Spot Trending / Discover / Top Traded / Organic / Launchpads views.
  - Routes across Raydium, Orca, Meteora, PumpSwap, and others.
  - Organic score helps filter genuine trading activity.
- **Context**: Jupiter remains the leading Solana aggregator by volume but faces competition (DFlow and others have taken significant share). Still the default for most swaps.
- **Practical checks**:
  - Compare volume and trader count on Jupiter vs. DexScreener for the same token.
  - Use Organic view to reduce wash-trading noise.
  - Check liquidity depth and price impact for realistic entry/exit sizing.

### Pump.fun (pump.fun)
- **Primary use**: New token launches, bonding curve status, and early-stage volume.
- **Mechanics**:
  - Tokens launch on a bonding curve.
  - Graduation (bonding curve completion) typically migrates liquidity to PumpSwap or another DEX.
  - Creators often add incentives (boosts, airdrops, holder rewards).
- **Trends**:
  - Dominant Solana launchpad by volume and fees; competitors appear periodically but Pump.fun usually regains share.
  - Popular narratives: AI/bot tokens, animal memes, celebrity/political references, paired tokens for synergy.
  - Extremely high failure rate — most tokens see little activity after the first few days.
  - High fee generation supports $PUMP buybacks and burns.
- **Practical checks**:
  - Confirm whether the token is still on the bonding curve or has graduated.
  - Note creator activity, holder count growth, and early volume relative to market cap.
  - Watch for volume dry-up after graduation.

### Combined Trend Workflow
1. Start on Pump.fun for fresh launches or bonding curve status.
2. Move to DexScreener once graduated for detailed charts, volume profile, and multi-timeframe price action.
3. Cross-check on Jupiter for organic volume, routing quality, and trader activity.
4. Look for confluence: rising volume + healthy liquidity + price acceptance + narrative momentum.

## Updated Solana-Specific Considerations

- New launches (especially pump.fun) are highly volatile; patterns on 1m–5m charts can reverse quickly. Most do not sustain.
- Bonding curve completion and migration often create volume and price volatility.
- Liquidity is frequently thin relative to reported volume on new tokens — always flag slippage risk.
- Narrative cycles (AI, animals, political, absurd memes) rotate rapidly.
- Always note that past patterns do not guarantee future results; Solana memecoins carry elevated risk of total loss.
- Prefer confirmation from multiple factors (price action + volume + liquidity + platform data) over single signals.

## Common Issues

| Issue | Approach |
|-------|----------|
| No chart data provided | Ask for timeframe, recent price action description, or key levels |
| Extremely new token | Emphasize early-stage risks and bonding curve dynamics |
| Conflicting signals | State the conflict and list conditions that would resolve it |

Prioritize clear, actionable observations while remaining explicit about the speculative nature of most Solana token analysis.
