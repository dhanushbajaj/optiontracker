import { useEffect, useRef, memo } from "react";

// ============================================================================
// TradingView embeds — free, client-side, no API key. They complement Finnhub
// (whose free tier has no historical candles) by providing real interactive
// price charts. Each widget injects TradingView's script with a JSON config.
// ============================================================================

function useTradingViewWidget(scriptSrc: string, config: object) {
  const ref = useRef<HTMLDivElement>(null);
  const cfg = JSON.stringify(config);
  useEffect(() => {
    const container = ref.current;
    if (!container) return;
    container.innerHTML =
      '<div class="tradingview-widget-container__widget"></div>';
    const script = document.createElement("script");
    script.src = scriptSrc;
    script.type = "text/javascript";
    script.async = true;
    script.innerHTML = cfg;
    container.appendChild(script);
    return () => {
      container.innerHTML = "";
    };
  }, [scriptSrc, cfg]);
  return ref;
}

/** Small 1-day mini chart — good for index tiles. */
export const MiniChart = memo(function MiniChart({
  symbol,
  height = 140,
}: {
  symbol: string;
  height?: number;
}) {
  const ref = useTradingViewWidget(
    "https://s3.tradingview.com/external-embedding/embed-widget-mini-symbol-overview.js",
    {
      symbol,
      width: "100%",
      height,
      locale: "en",
      dateRange: "1D",
      colorTheme: "dark",
      isTransparent: true,
      autosize: false,
      chartOnly: false,
      noTimeScale: false,
    }
  );
  return (
    <div className="tradingview-widget-container rounded-xl overflow-hidden" ref={ref} style={{ height }} />
  );
});

/** Full interactive advanced chart with symbol search. */
export const AdvancedChart = memo(function AdvancedChart({
  symbol,
  height = 480,
}: {
  symbol: string;
  height?: number;
}) {
  const ref = useTradingViewWidget(
    "https://s3.tradingview.com/external-embedding/embed-widget-advanced-chart.js",
    {
      autosize: true,
      symbol,
      interval: "D",
      timezone: "Etc/UTC",
      theme: "dark",
      style: "1",
      locale: "en",
      hide_side_toolbar: false,
      allow_symbol_change: true,
      calendar: false,
      backgroundColor: "rgba(10, 14, 20, 1)",
      gridColor: "rgba(31, 44, 61, 0.5)",
      support_host: "https://www.tradingview.com",
    }
  );
  return (
    <div
      className="tradingview-widget-container rounded-xl overflow-hidden border border-line"
      ref={ref}
      style={{ height }}
    />
  );
});

// TradingView resolves bare US tickers, but prefixing the exchange is more
// reliable for the common names in our universe.
const EXCHANGE: Record<string, string> = {
  SPY: "AMEX", QQQ: "NASDAQ", DIA: "AMEX", IWM: "AMEX",
  NVDA: "NASDAQ", AMD: "NASDAQ", AAPL: "NASDAQ", MSFT: "NASDAQ", TSLA: "NASDAQ",
  META: "NASDAQ", AMZN: "NASDAQ", GOOGL: "NASDAQ", NFLX: "NASDAQ", AVGO: "NASDAQ",
  PLTR: "NASDAQ", COIN: "NASDAQ", JPM: "NYSE", XOM: "NYSE", BA: "NYSE", LLY: "NYSE",
};
export function tvSymbol(ticker: string): string {
  const t = ticker.toUpperCase();
  return `${EXCHANGE[t] ?? "NASDAQ"}:${t}`;
}
