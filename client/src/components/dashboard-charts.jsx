// Dashboard charts built on the shadcn chart primitives (Recharts). Colours come from each chart's `config`,
// exposed by ChartContainer as --color-<key> variables, so light and dark themes follow the app palette.
import React, { useId } from 'react';
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, ComposedChart, Label, LabelList, Line, LineChart, Pie, PieChart, XAxis, YAxis } from 'recharts';
import { ChartContainer, ChartLegend, ChartLegendContent, ChartTooltip, ChartTooltipContent } from './ui/chart';

const X_AXIS = { dataKey: 't', tickLine: false, axisLine: false, tickMargin: 8, minTickGap: 36 };
const Y_AXIS = { tickLine: false, axisLine: false, tickMargin: 6, width: 60 };
// 10% headroom so a peak never touches the top edge of the plot.
const HEADROOM = [0, max => (max > 0 ? max * 1.1 : 1)];
// With only a few points per series a line reads as a spike; show the points themselves.
const sparse = (data, keys) => keys.some(key => data.filter(row => row[key] !== null && row[key] !== undefined).length < 12);
const keysOf = config => Object.keys(config);

function Tip({ timeFormat, valueFormat, indicator = 'dot', hideLabel = false }) {
  return (
    <ChartTooltipContent indicator={indicator} hideLabel={hideLabel} valueFormatter={valueFormat}
      labelFormatter={(_, payload) => (timeFormat && payload?.[0]?.payload?.t ? timeFormat(payload[0].payload.t) : null)} />
  );
}

// Unique gradient ids per chart instance, so two charts with the same series keys never share a fill.
function Gradients({ id, keys, opacity = 0.35 }) {
  return (
    <defs>
      {keys.map(key => (
        <linearGradient key={key} id={`${id}-${key}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="5%" stopColor={`var(--color-${key})`} stopOpacity={opacity} />
          <stop offset="95%" stopColor={`var(--color-${key})`} stopOpacity={0.02} />
        </linearGradient>
      ))}
    </defs>
  );
}

/** Time series as lines, gradient areas (optionally stacked) or steps. Null values leave gaps unless connectNulls. */
export function TimeSeriesChart({ data, config, kind = 'area', stacked = false, height = 240, xFormat, timeFormat, yFormat, valueFormat, connectNulls = false, yDomain }) {
  const id = useId().replace(/:/g, ''), keys = keysOf(config);
  const common = { accessibilityLayer: true, data, margin: { left: 0, right: 8, top: 8 } };
  const grid = <CartesianGrid vertical={false} />;
  const axes = [<XAxis key="x" {...X_AXIS} tickFormatter={xFormat} />, <YAxis key="y" {...Y_AXIS} tickFormatter={yFormat} domain={yDomain || HEADROOM} allowDecimals={!!yFormat} />];
  const dot = sparse(data, keys) ? { r: 3, strokeWidth: 0, fill: 'currentColor' } : false;
  const tooltip = <ChartTooltip cursor={kind !== 'line' && kind !== 'step'} content={<Tip timeFormat={timeFormat} valueFormat={valueFormat} indicator={kind === 'area' ? 'dot' : 'line'} />} />;
  const legend = keys.length > 1 ? <ChartLegend content={<ChartLegendContent />} /> : null;
  return (
    <ChartContainer config={config} className="chart-box" style={{ height }}>
      {kind === 'area' ? (
        <AreaChart {...common}>
          <Gradients id={id} keys={keys} />
          {grid}{axes}{tooltip}
          {keys.map(key => <Area key={key} dataKey={key} type="monotone" stroke={`var(--color-${key})`} strokeWidth={2} fill={`url(#${id}-${key})`} stackId={stacked ? 'a' : undefined} connectNulls={connectNulls} dot={dot && { ...dot, fill: `var(--color-${key})` }} isAnimationActive={false} />)}
          {legend}
        </AreaChart>
      ) : (
        <LineChart {...common}>
          {grid}{axes}{tooltip}
          {keys.map(key => <Line key={key} dataKey={key} type={kind === 'step' ? 'stepAfter' : 'monotone'} stroke={`var(--color-${key})`} strokeWidth={2} dot={dot && { ...dot, fill: `var(--color-${key})` }} activeDot={{ r: 4 }} connectNulls={connectNulls} isAnimationActive={false} />)}
          {legend}
        </LineChart>
      )}
    </ChartContainer>
  );
}

/** Stacked columns per interval, e.g. completed and failed jobs. The top segment gets rounded corners. */
export function StackedBarChart({ data, config, height = 240, xFormat, timeFormat, yFormat, valueFormat }) {
  const keys = keysOf(config);
  return (
    <ChartContainer config={config} className="chart-box" style={{ height }}>
      <BarChart accessibilityLayer data={data} margin={{ left: 0, right: 8, top: 8 }}>
        <CartesianGrid vertical={false} />
        <XAxis {...X_AXIS} tickFormatter={xFormat} />
        <YAxis {...Y_AXIS} tickFormatter={yFormat} allowDecimals={false} />
        <ChartTooltip cursor content={<Tip timeFormat={timeFormat} valueFormat={valueFormat} />} />
        <ChartLegend content={<ChartLegendContent />} />
        {keys.map((key, index) => <Bar key={key} dataKey={key} stackId="a" fill={`var(--color-${key})`} radius={index === keys.length - 1 ? [4, 4, 0, 0] : [0, 0, 0, 0]} isAnimationActive={false} />)}
      </BarChart>
    </ChartContainer>
  );
}

// Single-line axis label; Recharts' default tick wraps text to the axis width.
const RankTick = ({ x, y, payload }) => <text x={x} y={y} dy={4} textAnchor="end" className="chart-rank-tick" style={{ fontFamily: 'var(--font)', fontSize: 12.5 }}>{payload.value}</text>;

/** Horizontal ranking bars: names on a left axis so they never wrap inside short bars, counts at the bar end. */
export function RankingBarChart({ rows, config, valueFormat = String, labelWidth = 215 }) {
  // minHeight, not height: inside a .card.fill the chart grows to the row height and the bars spread out.
  const minHeight = Math.max(110, rows.length * 36 + 10);
  return (
    <ChartContainer config={config} className="chart-box" style={{ minHeight }}>
      <BarChart accessibilityLayer data={rows} layout="vertical" margin={{ left: 0, right: 36, top: 4, bottom: 4 }} maxBarSize={30} barCategoryGap="28%">
        <XAxis type="number" dataKey="count" hide domain={[0, 'dataMax']} />
        <YAxis type="category" dataKey="label" tickLine={false} axisLine={false} width={labelWidth} tickMargin={8} interval={0} tick={<RankTick />} />
        <ChartTooltip cursor={false} content={<ChartTooltipContent hideLabel nameKey="key" valueFormatter={valueFormat} />} />
        <Bar dataKey="count" radius={4} isAnimationActive={false}>
          {rows.map(row => <Cell key={row.key} fill={row.fill} />)}
          <LabelList dataKey="count" position="right" offset={8} className="chart-bar-value" fontSize={12} formatter={valueFormat} />
        </Bar>
      </BarChart>
    </ChartContainer>
  );
}

/** Donut with the total in the centre and a legend below. rows: [{ key, count, fill }]. */
export function DonutChart({ rows, config, centerLabel, height = 250, valueFormat }) {
  const total = rows.reduce((sum, row) => sum + row.count, 0);
  return (
    <ChartContainer config={config} className="chart-box" style={{ height }}>
      <PieChart>
        <ChartTooltip cursor={false} content={<ChartTooltipContent hideLabel nameKey="key" valueFormatter={valueFormat} />} />
        <Pie data={rows} dataKey="count" nameKey="key" innerRadius="58%" outerRadius="82%" paddingAngle={rows.length > 1 ? 2 : 0} strokeWidth={0} isAnimationActive={false}>
          {rows.map(row => <Cell key={row.key} fill={row.fill} />)}
          <Label content={({ viewBox }) => (viewBox && 'cx' in viewBox ? (
            <text x={viewBox.cx} y={viewBox.cy} textAnchor="middle" dominantBaseline="middle">
              <tspan x={viewBox.cx} y={viewBox.cy} className="chart-center-value">{total.toLocaleString()}</tspan>
              <tspan x={viewBox.cx} y={(viewBox.cy || 0) + 20} className="chart-center-label">{centerLabel}</tspan>
            </text>
          ) : null)} />
        </Pie>
        <ChartLegend content={<ChartLegendContent nameKey="key" />} />
      </PieChart>
    </ChartContainer>
  );
}

/** Request volume as muted bars (right axis) with average and P95 latency lines (left axis). */
export function LatencyVolumeChart({ data, config, height = 260, xFormat, timeFormat, msFormat, axisMsFormat, countFormat }) {
  const lines = keysOf(config).filter(key => key !== 'requests');
  return (
    <ChartContainer config={config} className="chart-box" style={{ height }}>
      <ComposedChart accessibilityLayer data={data} margin={{ left: 0, right: 0, top: 8 }}>
        <CartesianGrid vertical={false} />
        <XAxis {...X_AXIS} tickFormatter={xFormat} />
        <YAxis yAxisId="ms" {...Y_AXIS} tickFormatter={axisMsFormat} domain={HEADROOM} />
        <YAxis yAxisId="count" orientation="right" {...Y_AXIS} width={40} tickFormatter={countFormat} allowDecimals={false} />
        <ChartTooltip content={<Tip timeFormat={timeFormat} valueFormat={(value, item) => (item.dataKey === 'requests' ? countFormat(value) : msFormat(value))} />} />
        <ChartLegend content={<ChartLegendContent />} />
        <Bar yAxisId="count" dataKey="requests" fill="var(--color-requests)" radius={[3, 3, 0, 0]} isAnimationActive={false} />
        {lines.map(key => <Line key={key} yAxisId="ms" dataKey={key} type="monotone" stroke={`var(--color-${key})`} strokeWidth={2} dot={sparse(data, lines) ? { r: 3, strokeWidth: 0, fill: `var(--color-${key})` } : false} activeDot={{ r: 4 }} isAnimationActive={false} />)}
      </ComposedChart>
    </ChartContainer>
  );
}
