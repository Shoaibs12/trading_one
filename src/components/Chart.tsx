'use client';

import { useEffect, useRef } from 'react';
import { createChart, ColorType, IChartApi } from 'lightweight-charts';

interface ChartProps {
  data: any[];
  ema9Data?: any[];
  ema21Data?: any[];
  bbData?: any[];
  tradeMarkers?: any[];
}

export default function Chart({ data, ema9Data, ema21Data, bbData, tradeMarkers }: ChartProps) {
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleSeriesRef = useRef<any>(null);
  const ema9SeriesRef = useRef<any>(null);
  const ema21SeriesRef = useRef<any>(null);
  const bbUpperSeriesRef = useRef<any>(null);
  const bbMiddleSeriesRef = useRef<any>(null);
  const bbLowerSeriesRef = useRef<any>(null);

  // Create chart once
  useEffect(() => {
    if (!chartContainerRef.current) return;

    const chart = createChart(chartContainerRef.current, {
      layout: {
        background: { type: ColorType.Solid, color: 'transparent' },
        textColor: '#64748b',
        fontFamily: "'Inter', sans-serif",
        fontSize: 11,
      },
      grid: {
        vertLines: { color: 'rgba(255, 255, 255, 0.03)' },
        horzLines: { color: 'rgba(255, 255, 255, 0.03)' },
      },
      width: chartContainerRef.current.clientWidth,
      height: 400,
      crosshair: {
        mode: 0,
        vertLine: {
          color: 'rgba(79, 143, 255, 0.3)',
          width: 1,
          style: 2,
          labelBackgroundColor: '#1e293b',
        },
        horzLine: {
          color: 'rgba(79, 143, 255, 0.3)',
          width: 1,
          style: 2,
          labelBackgroundColor: '#1e293b',
        },
      },
      rightPriceScale: {
        borderColor: 'rgba(255, 255, 255, 0.06)',
        scaleMargins: { top: 0.1, bottom: 0.1 },
      },
      timeScale: {
        borderColor: 'rgba(255, 255, 255, 0.06)',
        timeVisible: true,
        secondsVisible: false,
      },
    });

    chartRef.current = chart;

    // Candlestick series
    const candleSeries = chart.addCandlestickSeries({
      upColor: '#00d68f',
      downColor: '#ff4757',
      borderVisible: false,
      wickUpColor: '#00d68f',
      wickDownColor: '#ff4757',
    });
    candleSeriesRef.current = candleSeries;

    // EMA 9 line (cyan)
    const ema9Series = chart.addLineSeries({
      color: '#00e5ff',
      lineWidth: 1,
      crosshairMarkerVisible: false,
      priceLineVisible: false,
      lastValueVisible: false,
    });
    ema9SeriesRef.current = ema9Series;

    // EMA 21 line (orange)
    const ema21Series = chart.addLineSeries({
      color: '#ff9800',
      lineWidth: 1,
      crosshairMarkerVisible: false,
      priceLineVisible: false,
      lastValueVisible: false,
    });
    ema21SeriesRef.current = ema21Series;

    // Bollinger Bands upper (dashed)
    const bbUpperSeries = chart.addLineSeries({
      color: 'rgba(168, 85, 247, 0.4)',
      lineWidth: 1,
      lineStyle: 2,
      crosshairMarkerVisible: false,
      priceLineVisible: false,
      lastValueVisible: false,
    });
    bbUpperSeriesRef.current = bbUpperSeries;

    // Bollinger Bands middle (yellow)
    const bbMiddleSeries = chart.addLineSeries({
      color: 'rgba(255, 213, 79, 0.5)',
      lineWidth: 1,
      crosshairMarkerVisible: false,
      priceLineVisible: false,
      lastValueVisible: false,
    });
    bbMiddleSeriesRef.current = bbMiddleSeries;

    // Bollinger Bands lower (dashed)
    const bbLowerSeries = chart.addLineSeries({
      color: 'rgba(168, 85, 247, 0.4)',
      lineWidth: 1,
      lineStyle: 2,
      crosshairMarkerVisible: false,
      priceLineVisible: false,
      lastValueVisible: false,
    });
    bbLowerSeriesRef.current = bbLowerSeries;

    // Resize handler
    const handleResize = () => {
      if (chartContainerRef.current) {
        chart.applyOptions({ width: chartContainerRef.current.clientWidth });
      }
    };

    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      chart.remove();
    };
  }, []);

  // Update data
  useEffect(() => {
    if (!candleSeriesRef.current || !data || data.length === 0) return;

    const formattedCandles = [...data]
      .sort((a, b) => a.timestamp - b.timestamp)
      .map((d) => ({
        time: (Math.floor(d.timestamp / 1000)) as any,
        open: d.open,
        high: d.high,
        low: d.low,
        close: d.close,
      }));

    candleSeriesRef.current.setData(formattedCandles);

    // EMA 9
    if (ema9SeriesRef.current && ema9Data && ema9Data.length > 0) {
      ema9SeriesRef.current.setData(ema9Data);
    }

    // EMA 21
    if (ema21SeriesRef.current && ema21Data && ema21Data.length > 0) {
      ema21SeriesRef.current.setData(ema21Data);
    }

    // Bollinger Bands
    if (bbData && bbData.length > 0) {
      if (bbUpperSeriesRef.current) {
        bbUpperSeriesRef.current.setData(bbData.map((d: any) => ({ time: d.time, value: d.upper })));
      }
      if (bbMiddleSeriesRef.current) {
        bbMiddleSeriesRef.current.setData(bbData.map((d: any) => ({ time: d.time, value: d.middle })));
      }
      if (bbLowerSeriesRef.current) {
        bbLowerSeriesRef.current.setData(bbData.map((d: any) => ({ time: d.time, value: d.lower })));
      }
    }

    // Trade markers
    if (tradeMarkers && tradeMarkers.length > 0) {
      const markers = tradeMarkers
        .map((m: any) => ({
          time: (typeof m.time === 'number' && m.time > 1e12 ? Math.floor(m.time / 1000) : m.time) as any,
          position: m.type === 'BUY' ? 'belowBar' as const : 'aboveBar' as const,
          color: m.type === 'BUY' ? '#00d68f' : '#ff4757',
          shape: m.type === 'BUY' ? 'arrowUp' as const : 'arrowDown' as const,
          text: `${m.type} $${Number(m.price).toFixed(0)}`,
        }))
        .sort((a: any, b: any) => {
          const timeA = typeof a.time === 'object' ? 0 : a.time;
          const timeB = typeof b.time === 'object' ? 0 : b.time;
          return timeA - timeB;
        });

      candleSeriesRef.current.setMarkers(markers);
    }

    // Fit content
    if (chartRef.current) {
      chartRef.current.timeScale().fitContent();
    }
  }, [data, ema9Data, ema21Data, bbData, tradeMarkers]);

  return <div ref={chartContainerRef} className="chart-container" />;
}
