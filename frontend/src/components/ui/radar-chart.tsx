"use client"

import * as React from "react"
import {
  PolarAngleAxis,
  PolarGrid,
  PolarRadiusAxis,
  Radar,
  RadarChart as RechartsRadarChart,
} from "recharts"

import { cn } from "@/lib/utils"
import {
  type CategoricalChartProps,
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
  buildCategoricalChartConfig,
  toCssVarKey,
} from "@/components/ui/chart"

export interface RadarChartProps
  extends CategoricalChartProps,
    Omit<React.HTMLAttributes<HTMLDivElement>, keyof CategoricalChartProps> {
  /** Numeric radius-axis ticks. Defaults to false — the polygon shape alone reads cleaner. */
  showRadiusAxis?: boolean
  gridType?: "polygon" | "circle"
  /** Opacity of each series' filled polygon. */
  fillOpacity?: number
}

const RadarChart = React.forwardRef<HTMLDivElement, RadarChartProps>(
  (
    {
      data,
      index,
      categories,
      colors,
      config,
      valueFormatter,
      indexFormatter,
      showLegend,
      showGrid = true,
      showTooltip = true,
      height = 320,
      showRadiusAxis = false,
      gridType = "polygon",
      fillOpacity = 0.15,
      className,
      ...props
    },
    ref
  ) => {
    const chartConfig = buildCategoricalChartConfig(categories, colors, config)
    const shouldShowLegend = showLegend ?? categories.length >= 2
    // Recharts v3's auto radius-domain calculation does not reliably pick
    // up the value range across Radar's categories — an explicit numeric
    // domain is required or every polygon collapses to a near-zero radius.
    const radiusDomainMax = Math.max(
      1,
      ...data.flatMap((row) => categories.map((category) => Number(row[category]) || 0))
    )

    return (
      <ChartContainer
        ref={ref}
        config={chartConfig}
        height={height}
        className={cn("w-full", className)}
        {...props}
      >
        <RechartsRadarChart data={data}>
          {showGrid && <PolarGrid stroke="var(--border)" gridType={gridType} />}
          <PolarAngleAxis
            dataKey={index}
            tick={{ fill: "var(--muted-foreground)", fontSize: 12 }}
            tickFormatter={
              indexFormatter ? (value) => indexFormatter(value) : undefined
            }
          />
          {/*
            Always rendered (never omitted, only visually hidden) — this
            axis establishes the value-to-radius scale for every Radar
            polygon. Two things are required for it to work at all: an
            explicit `type="number"` (its "auto" type detection does not
            reliably resolve to numeric for Radar's per-series dataKeys)
            and an explicit `domain` (its "auto" domain calculation is
            similarly unreliable here). Without either, every polygon
            collapses to a near-zero radius with no error.
          */}
          <PolarRadiusAxis
            type="number"
            domain={[0, radiusDomainMax]}
            axisLine={showRadiusAxis}
            tick={showRadiusAxis ? { fill: "var(--muted-foreground)", fontSize: 11 } : false}
            tickFormatter={valueFormatter}
          />
          {showTooltip && (
            <ChartTooltip
              content={
                <ChartTooltipContent
                  indicator="dot"
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
            <ChartLegend content={<ChartLegendContent />} />
          )}
          {categories.map((category) => (
            <Radar
              key={category}
              dataKey={category}
              stroke={`var(--color-${toCssVarKey(category)})`}
              fill={`var(--color-${toCssVarKey(category)})`}
              fillOpacity={fillOpacity}
              strokeWidth={2}
              dot={{ r: 3 }}
            />
          ))}
        </RechartsRadarChart>
      </ChartContainer>
    )
  }
)
RadarChart.displayName = "RadarChart"

export { RadarChart }
