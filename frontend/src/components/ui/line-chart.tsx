"use client"

import * as React from "react"
import {
  CartesianGrid,
  Line,
  LineChart as RechartsLineChart,
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

export interface LineChartProps
  extends CategoricalChartProps,
    Omit<React.HTMLAttributes<HTMLDivElement>, keyof CategoricalChartProps> {
  curveType?: "linear" | "monotone" | "step"
  showDots?: boolean
}

const LineChart = React.forwardRef<HTMLDivElement, LineChartProps>(
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
      showDots = false,
      className,
      ...props
    },
    ref
  ) => {
    const chartConfig = buildCategoricalChartConfig(categories, colors, config)
    const shouldShowLegend = showLegend ?? categories.length >= 2

    return (
      <ChartContainer
        ref={ref}
        config={chartConfig}
        height={height}
        className={cn("w-full", className)}
        {...props}
      >
        <RechartsLineChart data={data}>
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
                  indicator="line"
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
            <Line
              key={category}
              type={curveType}
              dataKey={category}
              stroke={`var(--color-${toCssVarKey(category)})`}
              strokeWidth={2}
              dot={showDots}
              activeDot={{ r: 4 }}
            />
          ))}
        </RechartsLineChart>
      </ChartContainer>
    )
  }
)
LineChart.displayName = "LineChart"

export { LineChart }
