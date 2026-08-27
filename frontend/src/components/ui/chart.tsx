"use client"

import * as React from "react"
import * as RechartsPrimitive from "recharts"

import { cn } from "@/lib/utils"

export type ChartConfig = {
  [key: string]: {
    label?: React.ReactNode
    icon?: React.ComponentType
  } & (
    | { color?: string; theme?: never }
    | { color?: never; theme: { light: string; dark: string } }
  )
}

/**
 * Categorical color order for the six --chart-N tokens, reordered (not
 * revalued) from their declared chart-1..6 sequence: the naive order puts
 * chart-1/chart-2 (violet/blue) and chart-3/chart-6 (pink/rose) adjacent,
 * which fail colorblind-safe separation. This order passes the dataviz
 * validator's adjacent-pair checks in both light and dark mode (the chart
 * vars carry no .dark override, so the result holds in both themes).
 */
export const DEFAULT_CHART_COLORS = [
  "var(--chart-4)",
  "var(--chart-2)",
  "var(--chart-5)",
  "var(--chart-6)",
  "var(--chart-1)",
  "var(--chart-3)",
] as const

/**
 * CSS custom-property names can't contain spaces or most punctuation.
 * Config keys are often arbitrary display strings (e.g. a pie slice's
 * `nameKey` value like "Owned components"), so every `--color-<key>`
 * declaration and every `var(--color-<key>)` reference must run through
 * this first — otherwise the declaration is silently invalid CSS and the
 * mark falls back to a default (black) fill with no error.
 */
export function toCssVarKey(key: string): string {
  const slug = String(key)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
  return slug || "value"
}

/**
 * Resolves the config/identity key for one tooltip or legend payload item.
 * `nameKey`, when given, looks up an alternate field on the item's raw data
 * row (e.g. a Pie chart's `nameKey` field) — it is NOT used as a literal
 * key itself, since every row would then collide on the same key.
 */
function resolvePayloadKey(
  item: ChartPayloadItem,
  index: number,
  nameKey?: string
): string {
  if (nameKey && item.payload && typeof item.payload[nameKey] === "string") {
    return item.payload[nameKey] as string
  }
  return String(item.dataKey ?? item.name ?? index)
}

interface ChartContextValue {
  config: ChartConfig
}

const ChartContext = React.createContext<ChartContextValue | null>(null)

function useChart() {
  const context = React.useContext(ChartContext)
  if (!context) {
    throw new Error("useChart must be used within a <ChartContainer>")
  }
  return context
}

export interface ChartContainerProps
  extends Omit<React.ComponentProps<"div">, "children"> {
  config: ChartConfig
  children: React.ComponentProps<
    typeof RechartsPrimitive.ResponsiveContainer
  >["children"]
  height?: number | string
}

const ChartContainer = React.forwardRef<HTMLDivElement, ChartContainerProps>(
  ({ config, className, children, height = 320, style, ...props }, ref) => {
    const uniqueId = React.useId()
    const chartId = `chart-${uniqueId.replace(/:/g, "")}`

    return (
      <ChartContext.Provider value={{ config }}>
        <div
          ref={ref}
          data-chart={chartId}
          className={cn(
            "flex justify-center text-xs [&_.recharts-cartesian-axis-tick_text]:fill-muted-foreground [&_.recharts-cartesian-grid_line]:stroke-border [&_.recharts-curve.recharts-tooltip-cursor]:stroke-border [&_.recharts-dot[stroke='#fff']]:stroke-transparent [&_.recharts-layer]:outline-none [&_.recharts-sector]:outline-none [&_.recharts-sector[stroke='#fff']]:stroke-transparent [&_.recharts-surface]:outline-none",
            className
          )}
          style={{ height, ...style }}
          {...props}
        >
          <ChartStyle id={chartId} config={config} />
          <RechartsPrimitive.ResponsiveContainer>
            {children}
          </RechartsPrimitive.ResponsiveContainer>
        </div>
      </ChartContext.Provider>
    )
  }
)
ChartContainer.displayName = "ChartContainer"

const THEMES = { light: "", dark: ".dark" } as const

function ChartStyle({ id, config }: { id: string; config: ChartConfig }) {
  const entries = Object.entries(config).filter(
    ([, entry]) => entry.color || entry.theme
  )

  if (!entries.length) return null

  return (
    <style
      dangerouslySetInnerHTML={{
        __html: Object.entries(THEMES)
          .map(
            ([theme, prefix]) => `
${prefix} [data-chart=${id}] {
${entries
  .map(([key, entry]) => {
    const color =
      entry.theme?.[theme as keyof typeof entry.theme] ?? entry.color
    return color ? `  --color-${toCssVarKey(key)}: ${color};` : null
  })
  .filter(Boolean)
  .join("\n")}
}
`
          )
          .join("\n"),
      }}
    />
  )
}

const ChartTooltip = RechartsPrimitive.Tooltip

/**
 * Local, loose stand-in for Recharts' internal tooltip/legend payload item.
 * Recharts v3's own `Payload` type (recharts/types/state/tooltipSlice) now
 * requires a non-optional `graphicalItemId` we never construct ourselves,
 * so we don't import it — the runtime shape `content` receives is unchanged
 * from v2 for the fields we actually read.
 */
export interface ChartPayloadItem {
  dataKey?: string | number
  name?: string | number
  value?: number | string
  color?: string
  fill?: string
  payload?: Record<string, unknown>
}

export interface ChartTooltipContentProps {
  active?: boolean
  payload?: ChartPayloadItem[]
  label?: React.ReactNode
  className?: string
  indicator?: "line" | "dot" | "dashed"
  hideLabel?: boolean
  hideIndicator?: boolean
  labelFormatter?: (
    label: React.ReactNode,
    payload: ChartPayloadItem[]
  ) => React.ReactNode
  formatter?: (
    value: number | string,
    name: string,
    item: ChartPayloadItem
  ) => React.ReactNode
  labelKey?: string
  nameKey?: string
}

const ChartTooltipContent = React.forwardRef<
  HTMLDivElement,
  ChartTooltipContentProps
>(
  (
    {
      active,
      payload,
      label,
      className,
      indicator = "dot",
      hideLabel = false,
      hideIndicator = false,
      labelFormatter,
      formatter,
      labelKey,
      nameKey,
    },
    ref
  ) => {
    const { config } = useChart()

    if (!active || !payload?.length) return null

    const resolvedLabel = hideLabel ? null : (
      <p className="font-medium text-popover-foreground">
        {labelFormatter
          ? labelFormatter(label, payload)
          : (labelKey && config[labelKey]?.label) ?? label}
      </p>
    )

    return (
      <div
        ref={ref}
        className={cn(
          "grid min-w-[140px] gap-1.5 rounded-md border border-border bg-popover px-3 py-2 text-xs text-popover-foreground shadow-sm",
          className
        )}
      >
        {resolvedLabel}
        <div className="grid gap-1">
          {payload.map((item, index) => {
            const key = resolvePayloadKey(item, index, nameKey)
            const entryConfig = config[key]
            const indicatorColor = item.color ?? item.fill

            return (
              <div
                key={key}
                className="flex w-full items-center gap-2"
              >
                {!hideIndicator && (
                  <span
                    className={cn(
                      "shrink-0 rounded-[2px]",
                      indicator === "dot" && "size-2",
                      indicator === "line" && "h-2 w-1",
                      indicator === "dashed" &&
                        "h-0 w-2.5 border-t-2 border-dashed"
                    )}
                    style={{
                      backgroundColor:
                        indicator !== "dashed" ? indicatorColor : undefined,
                      borderColor:
                        indicator === "dashed" ? indicatorColor : undefined,
                    }}
                  />
                )}
                <div className="flex flex-1 items-center justify-between gap-4 leading-none">
                  <span className="text-muted-foreground">
                    {entryConfig?.label ?? item.name ?? key}
                  </span>
                  <span className="font-medium tabular-nums text-popover-foreground">
                    {formatter && item.value !== undefined
                      ? formatter(item.value, key, item)
                      : item.value}
                  </span>
                </div>
              </div>
            )
          })}
        </div>
      </div>
    )
  }
)
ChartTooltipContent.displayName = "ChartTooltipContent"

const ChartLegend = RechartsPrimitive.Legend

export interface ChartLegendContentProps {
  payload?: ChartPayloadItem[]
  className?: string
  hideIcon?: boolean
  verticalAlign?: "top" | "bottom"
  nameKey?: string
}

const ChartLegendContent = React.forwardRef<
  HTMLDivElement,
  ChartLegendContentProps
>(({ payload, className, hideIcon = false, verticalAlign = "bottom", nameKey }, ref) => {
  const { config } = useChart()

  if (!payload?.length) return null

  return (
    <div
      ref={ref}
      className={cn(
        "flex flex-wrap items-center justify-center gap-4",
        verticalAlign === "top" ? "pb-3" : "pt-3",
        className
      )}
    >
      {payload.map((item, index) => {
        const key = resolvePayloadKey(item, index, nameKey)
        const entryConfig = config[key]
        const Icon = entryConfig?.icon

        return (
          <div key={key} className="flex items-center gap-1.5">
            {!hideIcon &&
              (Icon ? (
                <Icon />
              ) : (
                <span
                  className="size-2 shrink-0 rounded-[2px]"
                  style={{ backgroundColor: item.color ?? item.fill }}
                />
              ))}
            <span className="text-xs text-muted-foreground">
              {entryConfig?.label ?? item.name ?? key}
            </span>
          </div>
        )
      })}
    </div>
  )
})
ChartLegendContent.displayName = "ChartLegendContent"

/** Shared base prop shape for the cartesian ready components (Bar/Line/Area). */
export interface CategoricalChartProps {
  data: Record<string, unknown>[]
  /** Key on each data row used for the category/x-axis. */
  index: string
  /** Keys on each data row to plot as series. */
  categories: string[]
  /** Overrides DEFAULT_CHART_COLORS; sliced/cycled to categories.length. */
  colors?: string[]
  /** Per-series label/icon overrides — color still comes from `colors`. */
  config?: ChartConfig
  valueFormatter?: (value: number) => string
  indexFormatter?: (value: string | number) => string
  showLegend?: boolean
  showGrid?: boolean
  showTooltip?: boolean
  height?: number | string
  className?: string
}

/** Turns `categories` + optional overrides into a ChartConfig for ChartContainer. */
export function buildCategoricalChartConfig(
  categories: string[],
  colors: string[] | undefined,
  config: ChartConfig | undefined
): ChartConfig {
  const palette = colors && colors.length > 0 ? colors : DEFAULT_CHART_COLORS

  return Object.fromEntries(
    categories.map((key, i) => [
      key,
      {
        label: config?.[key]?.label ?? key,
        icon: config?.[key]?.icon,
        color: config?.[key]?.color ?? palette[i % palette.length],
      },
    ])
  )
}

export {
  ChartContainer,
  ChartStyle,
  ChartTooltip,
  ChartTooltipContent,
  ChartLegend,
  ChartLegendContent,
  useChart,
}
