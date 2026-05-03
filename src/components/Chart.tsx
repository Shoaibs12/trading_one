'use client';

import { useEffect, useRef } from 'react';
import { createChart, ColorType, IChartApi } from 'lightweight-charts';

export default function Chart({ data, smaData }: { data: any[], smaData?: any[] }) {
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<any>(null);
  const smaSeriesRef = useRef<any>(null);

  useEffect(() => {
    if (!chartContainerRef.current) return;

    const chart = createChart(chartContainerRef.current, {
      layout: {
        background: { type: ColorType.Solid, color: 'transparent' },
        textColor: '#c9d1d9',
      },
      grid: {
        vertLines: { color: '#30363d' },
        horzLines: { color: '#30363d' },
      },
      width: chartContainerRef.current.clientWidth,
      height: 400,
    });
    
    chartRef.current = chart;

    const candlestickSeries = chart.addCandlestickSeries({
      upColor: '#2ea043',
      downColor: '#da3633',
      borderVisible: false,
      wickUpColor: '#2ea043',
      wickDownColor: '#da3633',
    });
    seriesRef.current = candlestickSeries;

    const smaSeries = chart.addLineSeries({
      color: '#d29922',
      lineWidth: 2,
      crosshairMarkerVisible: false,
    });
    smaSeriesRef.current = smaSeries;

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

  // Update existing chart when new data comes
  useEffect(() => {
    if (!seriesRef.current || !data) return;
    
    const formattedData = [...data].sort((a, b) => a.timestamp - b.timestamp).map((d) => ({
      time: Math.floor(d.timestamp / 1000) as any,
      open: d.open,
      high: d.high,
      low: d.low,
      close: d.close,
    }));

    seriesRef.current.setData(formattedData);

    if (smaSeriesRef.current && smaData && smaData.length > 0) {
      smaSeriesRef.current.setData(smaData);
    }
  }, [data, smaData]);

  return <div ref={chartContainerRef} className="chart-container" />;
}
