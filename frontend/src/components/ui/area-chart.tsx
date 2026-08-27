"use client"

import * as React from "react"
import {
  Area,
  AreaChart as RechartsAreaChart,
  CartesianGrid,
  XAxis,
  YAxis,
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

export interface AreaChartProps
  extends CategoricalChartProps,
    Omit<React.HTMLAttributes<HTMLDivElement>, keyof CategoricalChartProps> {
  curveType?: "linear" | "monotone" | "step"
  stacked?: boolean
}

const AreaChart = React.forwardRef<HTMLDivElement, AreaChartProps>(
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
      curveType = "monotone",
      stacked = false,
      className,
      ...props
    },
    ref
  ) => {
    const chartConfig = buildCategoricalChartConfig(categories, colors, config)
    const shouldShowLegend = showLegend ?? categories.length >= 2
    // SVG ids are document-global, not scoped to this component instance —
    // a hardcoded gradient id would collide if this chart renders twice on
    // one page, so each instance/series pair gets its own id.
    const gradientId = React.useId()

    return (
      <ChartContainer
        ref={ref}
        config={chartConfig}
        height={height}
        className={cn("w-full", className)}
        {...props}
      >
        <RechartsAreaChart data={data}>
          <defs>
            {categories.map((category) => (
              <linearGradient
                key={category}
                id={`${gradientId}-${toCssVarKey(category)}`}
                x1="0"
                y1="0"
                x2="0"
                y2="1"
              >
                <stop
                  offset="5%"
                  stopColor={`var(--color-${toCssVarKey(category)})`}
                  stopOpacity={0.35}
                />
                <stop
                  offset="95%"
                  stopColor={`var(--color-${toCssVarKey(category)})`}
                  stopOpacity={0.02}
                />
              </linearGradient>
            ))}
          </defs>
          {showGrid && (
            <CartesianGrid
              stroke="var(--border)"
              strokeDasharray="3 3"
              vertical={false}
            />
          )}
          <XAxis
            dataKey={index}
            tickLine={false}
            axisLine={false}
            tick={{ fill: "var(--muted-foreground)", fontSize: 12 }}
            tickFormatter={
              indexFormatter ? (value) => indexFormatter(value) : undefined
            }
          />
          <YAxis
            tickLine={false}
            axisLine={false}
            tick={{ fill: "var(--muted-foreground)", fontSize: 12 }}
            tickFormatter={valueFormatter}
          />
          {showTooltip && (
            <ChartTooltip
              cursor={{ stroke: "var(--border)", strokeWidth: 1 }}
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
            <Area
              key={category}
              type={curveType}
              dataKey={category}
              stroke={`var(--color-${toCssVarKey(category)})`}
              strokeWidth={2}
              fill={`url(#${gradientId}-${toCssVarKey(category)})`}
              stackId={stacked ? "stack" : undefined}
            />
          ))}
        </RechartsAreaChart>
      </ChartContainer>
    )
  }
)
AreaChart.displayName = "AreaChart"

export { AreaChart }
