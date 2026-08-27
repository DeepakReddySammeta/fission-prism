"use client"

import * as React from "react"
import { Cell, Pie, PieChart as RechartsPieChart } from "recharts"

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

export interface PieChartProps
  extends Omit<React.HTMLAttributes<HTMLDivElement>, "children"> {
  data: Record<string, unknown>[]
  /** Numeric value field. */
  dataKey: string
  /** Label field. */
  nameKey: string
  colors?: string[]
  config?: ChartConfig
  /** Ring vs. full pie. Defaults to true; overridden by innerRadius/outerRadius. */
  donut?: boolean
  innerRadius?: number | string
  outerRadius?: number | string
  valueFormatter?: (value: number) => string
  /** Direct percentage labels on slices. Defaults to true. */
  showLabels?: boolean
  /** Slices below this share of the total skip their direct label. */
  labelThreshold?: number
  showLegend?: boolean
  showTooltip?: boolean
  height?: number | string
}

interface SliceLabelProps {
  cx: number
  cy: number
  midAngle: number
  innerRadius: number
  outerRadius: number
  value: number
}

const PieChart = React.forwardRef<HTMLDivElement, PieChartProps>(
  (
    {
      data,
      dataKey,
      nameKey,
      colors,
      config,
      donut = true,
      innerRadius,
      outerRadius = "85%",
      valueFormatter,
      showLabels = true,
      labelThreshold = 0.05,
      showLegend,
      showTooltip = true,
      height = 280,
      className,
      ...props
    },
    ref
  ) => {
    const palette = colors && colors.length > 0 ? colors : DEFAULT_CHART_COLORS
    const resolvedInnerRadius =
      innerRadius ?? (donut ? "60%" : 0)
    const shouldShowLegend = showLegend ?? data.length >= 2

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

    const total = data.reduce((sum, entry) => sum + Number(entry[dataKey] ?? 0), 0)

    // Recharts clones this element per-slice with the computed geometry as
    // props (the documented `ReactElement` form of `Pie`'s `label` prop).
    function SliceLabel(labelProps: Partial<SliceLabelProps>) {
      const { cx, cy, midAngle, outerRadius: sliceOuterRadius, value } =
        labelProps
      if (
        cx === undefined ||
        cy === undefined ||
        midAngle === undefined ||
        sliceOuterRadius === undefined ||
        value === undefined
      ) {
        return null
      }

      const percent = total > 0 ? value / total : 0
      if (percent < labelThreshold) return null

      const radius = sliceOuterRadius + 14
      const radians = (-midAngle * Math.PI) / 180
      const x = cx + radius * Math.cos(radians)
      const y = cy + radius * Math.sin(radians)

      return (
        <text
          x={x}
          y={y}
          textAnchor={x > cx ? "start" : "end"}
          dominantBaseline="central"
          className="fill-muted-foreground text-xs"
        >
          {`${Math.round(percent * 100)}%`}
        </text>
      )
    }

    return (
      <ChartContainer
        ref={ref}
        config={chartConfig}
        height={height}
        className={cn("w-full", className)}
        {...props}
      >
        <RechartsPieChart>
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
            <ChartLegend
              content={<ChartLegendContent nameKey={nameKey} />}
            />
          )}
          <Pie
            data={data}
            dataKey={dataKey}
            nameKey={nameKey}
            innerRadius={resolvedInnerRadius}
            outerRadius={outerRadius}
            paddingAngle={2}
            label={showLabels ? <SliceLabel /> : false}
            labelLine={false}
          >
            {data.map((entry) => (
              <Cell
                key={String(entry[nameKey])}
                fill={`var(--color-${toCssVarKey(String(entry[nameKey]))})`}
                stroke="var(--card)"
                strokeWidth={2}
              />
            ))}
          </Pie>
        </RechartsPieChart>
      </ChartContainer>
    )
  }
)
PieChart.displayName = "PieChart"

export { PieChart }
