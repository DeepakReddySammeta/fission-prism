"use client"

import * as React from "react"
import {
  Bar,
  BarChart as RechartsBarChart,
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

export interface BarChartProps
  extends CategoricalChartProps,
    Omit<React.HTMLAttributes<HTMLDivElement>, keyof CategoricalChartProps> {
  /** "horizontal" = upright columns (default). "vertical" = horizontal bars. */
  layout?: "horizontal" | "vertical"
  stacked?: boolean
  barSize?: number
  /** Corner radius applied to the data-end of each bar only. */
  radius?: number
}

function computeRadius(
  layout: "horizontal" | "vertical",
  radius: number
): [number, number, number, number] {
  return layout === "vertical" ? [0, radius, radius, 0] : [radius, radius, 0, 0]
}

const BarChart = React.forwardRef<HTMLDivElement, BarChartProps>(
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
      layout = "horizontal",
      stacked = false,
      barSize,
      radius = 4,
      className,
      ...props
    },
    ref
  ) => {
    const chartConfig = buildCategoricalChartConfig(categories, colors, config)
    const shouldShowLegend = showLegend ?? categories.length >= 2
    const isVertical = layout === "vertical"

    return (
      <ChartContainer
        ref={ref}
        config={chartConfig}
        height={height}
        className={cn("w-full", className)}
        {...props}
      >
        <RechartsBarChart
          data={data}
          layout={layout}
          barGap={4}
          barCategoryGap={stacked ? "20%" : "16%"}
        >
          {showGrid && (
            <CartesianGrid
              stroke="var(--border)"
              strokeDasharray="3 3"
              horizontal={!isVertical}
              vertical={isVertical}
            />
          )}
          <XAxis
            type={isVertical ? "number" : "category"}
            dataKey={isVertical ? undefined : index}
            tickLine={false}
            axisLine={false}
            tick={{ fill: "var(--muted-foreground)", fontSize: 12 }}
            tickFormatter={
              isVertical
                ? valueFormatter
                : indexFormatter
                  ? (value) => indexFormatter(value)
                  : undefined
            }
          />
          <YAxis
            type={isVertical ? "category" : "number"}
            dataKey={isVertical ? index : undefined}
            width={isVertical ? 88 : undefined}
            tickLine={false}
            axisLine={false}
            tick={{ fill: "var(--muted-foreground)", fontSize: 12 }}
            tickFormatter={
              isVertical
                ? indexFormatter
                  ? (value) => indexFormatter(value)
                  : undefined
                : valueFormatter
            }
          />
          {showTooltip && (
            <ChartTooltip
              cursor={{ fill: "var(--muted)", opacity: 0.4 }}
              content={
                <ChartTooltipContent
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
          {categories.map((category, i) => (
            <Bar
              key={category}
              dataKey={category}
              fill={`var(--color-${toCssVarKey(category)})`}
              stackId={stacked ? "stack" : undefined}
              barSize={barSize}
              radius={
                !stacked || i === categories.length - 1
                  ? computeRadius(layout, radius)
                  : 0
              }
            />
          ))}
        </RechartsBarChart>
      </ChartContainer>
    )
  }
)
BarChart.displayName = "BarChart"

export { BarChart }
