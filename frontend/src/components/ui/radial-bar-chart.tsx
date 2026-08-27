"use client"

import * as React from "react"
import {
  Cell,
  PolarAngleAxis,
  RadialBar,
  RadialBarChart as RechartsRadialBarChart,
} from "recharts"

import { cn } from "@/lib/utils"
import {
  type ChartConfig,
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
  DEFAULT_CHART_COLORS,
  toCssVarKey,
} from "@/components/ui/chart"

export interface RadialBarChartProps
  extends Omit<React.HTMLAttributes<HTMLDivElement>, "children"> {
  data: Record<string, unknown>[]
  /** Numeric value field. */
  dataKey: string
  /** Label field. */
  nameKey: string
  colors?: string[]
  config?: ChartConfig
  /** Domain max each ring's arc is drawn against. Defaults to 100 (percentage-style values). */
  maxValue?: number
  startAngle?: number
  endAngle?: number
  /** Corner radius applied to the data-end of each ring. */
  cornerRadius?: number
  /** Full-circle track rendered behind each ring. */
  showBackground?: boolean
  valueFormatter?: (value: number) => string
  /** Big centered value overlay. Defaults to true only for a single ring. */
  showCenterLabel?: boolean
  showLegend?: boolean
  showTooltip?: boolean
  height?: number | string
}

const RadialBarChart = React.forwardRef<HTMLDivElement, RadialBarChartProps>(
  (
    {
      data,
      dataKey,
      nameKey,
      colors,
      config,
      maxValue = 100,
      startAngle = 90,
      endAngle = -270,
      cornerRadius = 6,
      showBackground = true,
      valueFormatter,
      showCenterLabel,
      showLegend,
      showTooltip = true,
      height = 280,
      className,
      ...props
    },
    ref
  ) => {
    const palette = colors && colors.length > 0 ? colors : DEFAULT_CHART_COLORS
    const shouldShowLegend = showLegend ?? data.length >= 2
    const resolvedShowCenterLabel = showCenterLabel ?? data.length === 1

    const chartConfig: ChartConfig = Object.fromEntries(
      data.map((entry, i) => {
        const key = String(entry[nameKey])
        return [
          key,
          {
            label: config?.[key]?.label ?? key,
            icon: config?.[key]?.icon,
            color: config?.[key]?.color ?? palette[i % palette.length],
          },
        ]
      })
    )

    return (
      <div ref={ref} className={cn("relative w-full", className)} {...props}>
        <ChartContainer config={chartConfig} height={height}>
          <RechartsRadialBarChart
            data={data}
            startAngle={startAngle}
            endAngle={endAngle}
            innerRadius="30%"
            outerRadius="90%"
          >
            <PolarAngleAxis
              type="number"
              domain={[0, maxValue]}
              angleAxisId={0}
              tick={false}
              axisLine={false}
            />
            {showTooltip && (
              <ChartTooltip
                content={
                  <ChartTooltipContent
                    hideLabel
                    nameKey={nameKey}
                    formatter={
                      valueFormatter
                        ? (value) => valueFormatter(Number(value))
                        : undefined
                    }
                  />
                }
              />
            )}
            {shouldShowLegend && (
              <ChartLegend content={<ChartLegendContent nameKey={nameKey} />} />
            )}
            <RadialBar
              dataKey={dataKey}
              angleAxisId={0}
              cornerRadius={cornerRadius}
              background={showBackground ? { fill: "var(--muted)" } : false}
            >
              {data.map((entry) => (
                <Cell
                  key={String(entry[nameKey])}
                  fill={`var(--color-${toCssVarKey(String(entry[nameKey]))})`}
                />
              ))}
            </RadialBar>
          </RechartsRadialBarChart>
        </ChartContainer>
        {resolvedShowCenterLabel && data[0] && (
          <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
            <span className="text-3xl font-bold text-foreground">
              {valueFormatter
                ? valueFormatter(Number(data[0][dataKey]))
                : Number(data[0][dataKey])}
            </span>
            <span className="text-xs text-muted-foreground">
              {String(data[0][nameKey])}
            </span>
          </div>
        )}
      </div>
    )
  }
)
RadialBarChart.displayName = "RadialBarChart"

export { RadialBarChart }
