// Small server-rendered charts for the IT dashboard. Plain HTML + Tailwind, no chart library.
// Single series only, so one hue (validated: #2a78d6 passes lightness, chroma and 3:1 contrast
// on the white card). Text uses ink colours, never the series colour. Every chart has a
// hover/focus tooltip and a table view.

const SERIES = "#2a78d6";
const GRID = "#e1e0d9";

function niceMax(value: number) {
  if (value <= 4) return 4;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  const steps = [1, 2, 2.5, 5, 10];
  const step = steps.find((s) => s * magnitude * 4 >= value)! * magnitude;
  return step * 4;
}

function TableView({
  caption,
  headers,
  rows,
}: {
  caption: string;
  headers: [string, string];
  rows: [string, string | number][];
}) {
  return (
    <details className="mt-3">
      <summary className="cursor-pointer text-xs text-slate-500 hover:text-slate-700">
        Show as table
      </summary>
      <div className="mt-2 overflow-x-auto">
        <table className="w-full text-left text-xs">
          <caption className="sr-only">{caption}</caption>
          <thead className="text-slate-400">
            <tr>
              <th className="py-1 pr-4 font-medium">{headers[0]}</th>
              <th className="py-1 font-medium">{headers[1]}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 tabular-nums text-slate-700">
            {rows.map(([label, value]) => (
              <tr key={label}>
                <td className="py-1 pr-4">{label}</td>
                <td className="py-1">{value}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}

// Weekly ticket volume: columns <= 24px, 4px rounded top, square at the baseline, hairline grid.
export function ColumnChart({
  title,
  points,
}: {
  title: string;
  points: { label: string; tooltip: string; value: number }[];
}) {
  const max = niceMax(Math.max(0, ...points.map((p) => p.value)));
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => Math.round(max * f));
  const labelEvery = points.length > 8 ? 2 : 1;

  return (
    <figure>
      <figcaption className="sr-only">{title}</figcaption>
      <div className="flex gap-2">
        {/* y-axis */}
        <div className="relative h-40 w-8 shrink-0 text-right text-[11px] tabular-nums text-slate-400">
          {ticks.map((t) => (
            <span
              key={t}
              className="absolute right-0"
              // Centre the label on its gridline (bottom anchors the label's lower edge).
              style={{ bottom: `${(t / max) * 100}%`, transform: "translateY(50%)" }}
            >
              {t.toLocaleString()}
            </span>
          ))}
        </div>
        <div className="min-w-0 flex-1">
          <div className="relative h-40">
            {ticks.map((t) => (
              <div
                key={t}
                className="absolute inset-x-0 h-px"
                style={{ bottom: `${(t / max) * 100}%`, backgroundColor: GRID }}
              />
            ))}
            <div className="absolute inset-0 flex items-end">
              {points.map((p) => (
                <div
                  key={p.label}
                  tabIndex={0}
                  aria-label={p.tooltip}
                  className="group relative flex h-full flex-1 items-end justify-center outline-none"
                >
                  <div
                    className="w-full max-w-6 rounded-t transition-opacity group-hover:opacity-80"
                    style={{
                      height: `${(p.value / max) * 100}%`,
                      minHeight: p.value > 0 ? 2 : 0,
                      backgroundColor: SERIES,
                      marginInline: 2,
                    }}
                  />
                  <div className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-1 hidden -translate-x-1/2 whitespace-nowrap rounded-md bg-slate-900 px-2 py-1 text-xs text-white shadow group-hover:block group-focus-visible:block">
                    {p.tooltip}
                  </div>
                </div>
              ))}
            </div>
          </div>
          <div className="mt-1 flex text-[11px] text-slate-400">
            {points.map((p, i) => (
              <span key={p.label} className="flex-1 truncate text-center">
                {i % labelEvery === 0 ? p.label : ""}
              </span>
            ))}
          </div>
        </div>
      </div>
      <TableView
        caption={title}
        headers={["Week starting", "Tickets"]}
        rows={points.map((p) => [p.label, p.value])}
      />
    </figure>
  );
}

// Horizontal bars, sorted by the caller. 16px bars, value at the tip.
export function BarList({
  title,
  rows,
  valueHeader = "Tickets",
  emptyText = "No data for this period.",
}: {
  title: string;
  rows: { label: string; value: number; tooltip?: string }[];
  valueHeader?: string;
  emptyText?: string;
}) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  if (rows.length === 0) return <p className="py-6 text-center text-sm text-slate-400">{emptyText}</p>;

  return (
    <figure>
      <figcaption className="sr-only">{title}</figcaption>
      <ul className="space-y-2">
        {rows.map((r) => (
          <li
            key={r.label}
            tabIndex={0}
            aria-label={r.tooltip ?? `${r.label}: ${r.value}`}
            className="group relative grid grid-cols-[minmax(0,9rem)_1fr] items-center gap-3 outline-none"
          >
            <span className="truncate text-sm text-slate-600" title={r.label}>
              {r.label}
            </span>
            <div className="flex items-center gap-2">
              <div
                className="h-4 rounded-r transition-opacity group-hover:opacity-80"
                style={{
                  width: `${(r.value / max) * 85}%`,
                  minWidth: r.value > 0 ? 2 : 0,
                  backgroundColor: SERIES,
                }}
              />
              <span className="text-sm tabular-nums text-slate-700">{r.value.toLocaleString()}</span>
            </div>
            {r.tooltip && (
              <div className="pointer-events-none absolute -top-7 left-36 z-10 hidden whitespace-nowrap rounded-md bg-slate-900 px-2 py-1 text-xs text-white shadow group-hover:block group-focus-visible:block">
                {r.tooltip}
              </div>
            )}
          </li>
        ))}
      </ul>
      <TableView
        caption={title}
        headers={["", valueHeader]}
        rows={rows.map((r) => [r.label, r.value])}
      />
    </figure>
  );
}

// KPI stat tile: label, value, optional context line. `alert` adds a text label + red value,
// so the state never rides on colour alone.
export function StatTile({
  label,
  value,
  context,
  alert,
}: {
  label: string;
  value: string;
  context?: string;
  alert?: string | false;
}) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white px-5 py-4 shadow-sm">
      <p className="text-xs font-medium text-slate-500">{label}</p>
      <p className={`mt-1 text-2xl font-semibold ${alert ? "text-red-600" : "text-slate-900"}`}>
        {value}
      </p>
      {(alert || context) && (
        <p className={`mt-0.5 text-xs ${alert ? "font-medium text-red-600" : "text-slate-400"}`}>
          {alert || context}
        </p>
      )}
    </div>
  );
}
