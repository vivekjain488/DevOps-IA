import React, { useMemo, useState } from 'react';
import { useElementWidth } from './lib';

const PAD = { top: 14, right: 14, bottom: 26, left: 46 };

function niceStep(raw) {
  const exponent = Math.floor(Math.log10(raw)), fraction = raw / 10 ** exponent;
  const nice = fraction <= 1 ? 1 : fraction <= 2 ? 2 : fraction <= 2.5 ? 2.5 : fraction <= 5 ? 5 : 10;
  return nice * 10 ** exponent;
}
function scaleY(max, integer) {
  if (!(max > 0)) return { max: integer ? 4 : 1, ticks: integer ? [0, 1, 2, 3, 4] : [0, 0.25, 0.5, 0.75, 1] };
  let step = niceStep(max / 4); if (integer) step = Math.max(1, Math.ceil(step));
  const top = Math.ceil(max / step) * step, ticks = [];
  for (let value = 0; value <= top + step / 2; value += step) ticks.push(Number(value.toFixed(6)));
  return { max: top, ticks };
}
function xTickIndexes(count, width) {
  if (!count) return [];
  const wanted = Math.max(2, Math.min(count, Math.floor(width / 92))), step = (count - 1) / (wanted - 1 || 1), out = new Set();
  for (let i = 0; i < wanted; i += 1) out.add(Math.round(i * step));
  return [...out];
}

function Frame({ width, height, scale, y, yFormat, ticks, xFormat, data, x }) {
  const plotBottom = height - PAD.bottom;
  return (
    <g className="chart-frame">
      {scale.ticks.map((tick, index) => {
        const ty = y(tick);
        return (
          <g key={tick}>
            <line x1={PAD.left} x2={width - PAD.right} y1={ty} y2={ty} className={index === 0 ? 'axis-base' : 'gridline'} />
            <text x={PAD.left - 8} y={ty} dy="0.32em" textAnchor="end" className="tick">{yFormat(tick)}</text>
          </g>
        );
      })}
      {ticks.map(index => (
        <text key={index} x={x(index)} y={plotBottom + 17} textAnchor={index === 0 ? 'start' : index === data.length - 1 ? 'end' : 'middle'} className="tick">{xFormat(data[index].time)}</text>
      ))}
    </g>
  );
}

function Tooltip({ left, width, title, rows }) {
  const flip = left > width - 190;
  return (
    <div className="chart-tip" style={flip ? { right: width - left + 12 } : { left: left + 12 }} role="status">
      <div className="chart-tip-title">{title}</div>
      {rows.map(row => (
        <div className="chart-tip-row" key={row.label}>
          <i style={{ background: row.color }} className={row.shape === 'line' ? 'line' : ''} /><span>{row.label}</span><b>{row.value}</b>
        </div>
      ))}
    </div>
  );
}

export function Legend({ series }) {
  return (
    <ul className="legend">
      {series.map(item => <li key={item.key}><i style={{ background: item.color }} className={item.shape === 'line' ? 'line' : ''} />{item.label}</li>)}
    </ul>
  );
}

const present = value => value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value));

// Log axis over whole decades, so 5 ms and 3 s can share one readable chart.
function scaleLog(values) {
  const positive = values.filter(value => value > 0);
  if (!positive.length) return { min: 1, max: 10, ticks: [1, 10] };
  let lo = 10 ** Math.floor(Math.log10(Math.min(...positive))), hi = 10 ** Math.ceil(Math.log10(Math.max(...positive)));
  if (hi <= lo) hi = lo * 10;
  const ticks = [];
  for (let tick = lo; tick <= hi * 1.0001; tick *= 10) ticks.push(Number(tick.toPrecision(6)));
  return { min: lo, max: hi, ticks };
}

// Monotone cubic (Fritsch-Carlson): smooth, but never overshoots below zero or past a peak.
function monotonePath(points) {
  if (points.length < 2) return '';
  const [first] = points;
  if (points.length === 2) return `M${first.x},${first.y}L${points[1].x},${points[1].y}`;
  const n = points.length, d = [], m = [];
  for (let k = 0; k < n - 1; k += 1) d.push((points[k + 1].y - points[k].y) / (points[k + 1].x - points[k].x));
  m[0] = d[0]; m[n - 1] = d[n - 2];
  for (let k = 1; k < n - 1; k += 1) m[k] = d[k - 1] * d[k] <= 0 ? 0 : (d[k - 1] + d[k]) / 2;
  for (let k = 0; k < n - 1; k += 1) {
    if (d[k] === 0) { m[k] = 0; m[k + 1] = 0; continue; }
    const a = m[k] / d[k], b = m[k + 1] / d[k], s = a * a + b * b;
    if (s > 9) { const t = 3 / Math.sqrt(s); m[k] = t * a * d[k]; m[k + 1] = t * b * d[k]; }
  }
  let path = `M${first.x.toFixed(1)},${first.y.toFixed(1)}`;
  for (let k = 0; k < n - 1; k += 1) {
    const p0 = points[k], p1 = points[k + 1], h = (p1.x - p0.x) / 3;
    path += `C${(p0.x + h).toFixed(1)},${(p0.y + m[k] * h).toFixed(1)} ${(p1.x - h).toFixed(1)},${(p1.y - m[k + 1] * h).toFixed(1)} ${p1.x.toFixed(1)},${p1.y.toFixed(1)}`;
  }
  return path;
}

/**
 * Multi-series line chart sharing one y-axis, with a crosshair tooltip.
 * data: [{ time, [key]: number|null }] — null marks an empty interval and breaks the line.
 * scale: 'linear' | 'log'. thresholds: [{ value, label }] reference lines drawn when in range.
 */
export function LineChart({ data, series, height = 230, yFormat = String, valueFormat = yFormat, xFormat, label, area = true, scale: scaleType = 'linear', thresholds = [] }) {
  const [ref, width] = useElementWidth(), [hover, setHover] = useState(null);
  const values = useMemo(() => data.flatMap(row => series.map(item => (present(row[item.key]) ? Number(row[item.key]) : null)).filter(value => value !== null)), [data, series]);
  const log = scaleType === 'log';
  const linear = scaleY(Math.max(0, ...values), false), logScale = scaleLog(values);
  const scale = log ? logScale : linear;
  const plotBottom = height - PAD.bottom, plotTop = PAD.top, plotWidth = Math.max(1, width - PAD.left - PAD.right);
  const x = index => PAD.left + (data.length > 1 ? (index / (data.length - 1)) * plotWidth : plotWidth / 2);
  const y = log
    ? value => { const v = Math.max(value, logScale.min), span = Math.log10(logScale.max) - Math.log10(logScale.min); return plotTop + (1 - (Math.log10(v) - Math.log10(logScale.min)) / span) * (plotBottom - plotTop); }
    : value => plotTop + (1 - value / linear.max) * (plotBottom - plotTop);
  const baseline = y(log ? logScale.min : 0);

  // Contiguous runs of real values; gaps (no traffic) stay visibly empty.
  const segmentsFor = key => {
    const runs = []; let run = [];
    data.forEach((row, index) => {
      if (present(row[key])) run.push({ index, x: x(index), y: y(Number(row[key])) });
      else if (run.length) { runs.push(run); run = []; }
    });
    if (run.length) runs.push(run);
    return runs;
  };
  const filled = data.filter(row => series.some(item => present(row[item.key]))).length;
  const sparse = filled < data.length * 0.5;

  const move = event => {
    const box = event.currentTarget.getBoundingClientRect(), px = event.clientX - box.left;
    const raw = Math.max(0, Math.min(data.length - 1, Math.round(((px - PAD.left) / plotWidth) * (data.length - 1))));
    // Snap to the nearest interval that has data, so sparse charts are easy to read.
    let best = raw, distance = Infinity;
    data.forEach((row, index) => { if (series.some(item => present(row[item.key])) && Math.abs(index - raw) < distance) { best = index; distance = Math.abs(index - raw); } });
    setHover(distance <= Math.max(2, data.length / 8) ? best : raw);
  };

  return (
    <div className="chart" ref={ref} style={{ height }}>
      {width > 0 && (
        <svg width={width} height={height} role="img" aria-label={label} onPointerMove={move} onPointerLeave={() => setHover(null)}>
          <Frame width={width} height={height} scale={scale} y={y} yFormat={yFormat} ticks={xTickIndexes(data.length, plotWidth)} xFormat={xFormat} data={data} x={x} />
          {thresholds.filter(t => t.value >= (log ? logScale.min : 0) && t.value <= scale.max).map(t => (
            <g key={t.value} className="threshold">
              <line x1={PAD.left} x2={width - PAD.right} y1={y(t.value)} y2={y(t.value)} />
              <text x={PAD.left + 6} y={y(t.value) - 6}>{t.label}</text>
            </g>
          ))}
          {area && series[0] && segmentsFor(series[0].key).filter(run => run.length > 1).map(run => (
            <path key={`area-${run[0].index}`} d={`${monotonePath(run)}L${run[run.length - 1].x},${baseline}L${run[0].x},${baseline}Z`} style={{ fill: series[0].color }} className="area-wash" />
          ))}
          {series.map(item => (
            <g key={item.key}>
              {segmentsFor(item.key).map(run => (run.length > 1
                ? <path key={run[0].index} d={monotonePath(run)} className="line" style={{ stroke: item.color }} />
                : <circle key={run[0].index} cx={run[0].x} cy={run[0].y} r="3.5" className="dot" style={{ fill: item.color }} />))}
              {sparse && segmentsFor(item.key).flat().map(point => <circle key={`m${point.index}`} cx={point.x} cy={point.y} r="3" className="dot" style={{ fill: item.color }} />)}
            </g>
          ))}
          {hover !== null && (
            <g>
              <line x1={x(hover)} x2={x(hover)} y1={plotTop} y2={plotBottom} className="crosshair" />
              {series.map(item => (present(data[hover][item.key])
                ? <circle key={item.key} cx={x(hover)} cy={y(Number(data[hover][item.key]))} r="5" className="dot" style={{ fill: item.color }} />
                : null))}
            </g>
          )}
          <rect x={PAD.left} y={plotTop} width={plotWidth} height={plotBottom - plotTop} fill="transparent" />
        </svg>
      )}
      {hover !== null && width > 0 && (
        <Tooltip left={x(hover)} width={width} title={xFormat(data[hover].time)}
          rows={series.map(item => ({ label: item.label, color: item.color, shape: 'line', value: present(data[hover][item.key]) ? valueFormat(Number(data[hover][item.key])) : 'No requests' }))} />
      )}
    </div>
  );
}

const roundedTop = (x, y, w, h, r) => {
  const radius = Math.min(r, w / 2, h);
  return `M${x},${y + h}V${y + radius}Q${x},${y} ${x + radius},${y}H${x + w - radius}Q${x + w},${y} ${x + w},${y + radius}V${y + h}Z`;
};

/** Stacked column chart; series listed bottom-to-top. Segments are separated by a 2px surface gap. */
export function ColumnChart({ data, series, height = 230, yFormat = String, valueFormat = yFormat, xFormat, label, totalLabel = 'Total' }) {
  const [ref, width] = useElementWidth(), [hover, setHover] = useState(null);
  const totals = useMemo(() => data.map(row => series.reduce((sum, item) => sum + (Number(row[item.key]) || 0), 0)), [data, series]);
  const scale = scaleY(Math.max(0, ...totals), true), plotBottom = height - PAD.bottom, plotWidth = Math.max(1, width - PAD.left - PAD.right);
  const slot = plotWidth / Math.max(1, data.length), barWidth = Math.max(2, Math.min(24, slot * 0.68));
  const x = index => PAD.left + slot * index + slot / 2;
  const h = value => (value / scale.max) * (plotBottom - PAD.top);
  const yOf = value => plotBottom - h(value);
  return (
    <div className="chart" ref={ref} style={{ height }}>
      {width > 0 && (
        <svg width={width} height={height} role="img" aria-label={label} onPointerLeave={() => setHover(null)}>
          <Frame width={width} height={height} scale={scale} y={yOf} yFormat={yFormat} ticks={xTickIndexes(data.length, plotWidth)} xFormat={xFormat} data={data} x={x} />
          {data.map((row, index) => {
            let base = plotBottom; const left = x(index) - barWidth / 2;
            const visible = series.map(item => ({ item, value: Number(row[item.key]) || 0 })).filter(part => part.value > 0);
            return (
              <g key={index} className={hover !== null && hover !== index ? 'col dim' : 'col'}>
                {visible.map((part, partIndex) => {
                  const full = h(part.value), top = partIndex === visible.length - 1, gap = partIndex > 0 && full > 3 ? 2 : 0;
                  const segment = Math.max(1, full - gap), yTop = base - gap - segment; base = yTop;
                  return top
                    ? <path key={part.item.key} d={roundedTop(left, yTop, barWidth, segment, 4)} style={{ fill: part.item.color }} />
                    : <rect key={part.item.key} x={left} y={yTop} width={barWidth} height={segment} style={{ fill: part.item.color }} />;
                })}
                <rect x={PAD.left + slot * index} y={PAD.top} width={slot} height={plotBottom - PAD.top} fill="transparent" onPointerEnter={() => setHover(index)} />
              </g>
            );
          })}
        </svg>
      )}
      {hover !== null && width > 0 && (
        <Tooltip left={x(hover)} width={width} title={xFormat(data[hover].time)}
          rows={[...series.slice().reverse().map(item => ({ label: item.label, color: item.color, value: valueFormat(Number(data[hover][item.key]) || 0) })), { label: totalLabel, color: 'transparent', value: valueFormat(totals[hover]) }]} />
      )}
    </div>
  );
}

/** Small trend line for stat tiles. No axes; the tile names the measure. */
export function Sparkline({ values, color = 'var(--series-1)', height = 36 }) {
  const [ref, width] = useElementWidth();
  const points = values.map(Number).filter(Number.isFinite);
  if (points.length < 2) return <div className="spark spark-empty" ref={ref} style={{ height }} />;
  const max = Math.max(...points), min = Math.min(...points), span = max - min || 1;
  const x = index => 2 + (index / (points.length - 1)) * (width - 6), y = value => 3 + (1 - (value - min) / span) * (height - 6);
  const line = points.map((value, index) => `${index ? 'L' : 'M'}${x(index).toFixed(1)},${y(value).toFixed(1)}`).join('');
  return (
    <div className="spark" ref={ref} style={{ height }}>
      {width > 0 && (
        <svg width={width} height={height} aria-hidden="true">
          <path d={`${line}L${x(points.length - 1)},${height}L${x(0)},${height}Z`} className="area-wash" style={{ fill: color }} />
          <path d={line} className="line thin" style={{ stroke: color }} />
          <circle cx={x(points.length - 1)} cy={y(points[points.length - 1])} r="3.5" className="dot" style={{ fill: color }} />
        </svg>
      )}
    </div>
  );
}

/** Horizontal share bar used inside tables and lists. */
export function ShareBar({ value, max, color = 'var(--series-1)' }) {
  const pct = max > 0 ? Math.max(2, (value / max) * 100) : 0;
  return <span className="share"><i style={{ width: `${pct}%`, background: color }} /></span>;
}
