import "./guardrail-tiers.css";

type Cell = "yes" | "partial" | "no";

interface Row {
  concern: string;
  runtime: Cell;
  scan: Cell;
  compile: Cell;
}

const COLS = [
  { key: "runtime", label: "Runtime", tier: "run it" },
  { key: "scan", label: "Scanner", tier: "scan it" },
  { key: "compile", label: "Type system", tier: "type it" },
] as const;

/** Edit these rows to match the concerns you want to show. A row is rendered
 *  as "promotable" (accented) when it reaches compile time. */
const ROWS: Row[] = [
  { concern: "Sensitive data tagging", runtime: "yes", scan: "yes", compile: "yes" },
  { concern: "Resilience (error handling)", runtime: "yes", scan: "partial", compile: "yes" },
  { concern: "Security (injection)", runtime: "yes", scan: "yes", compile: "yes" },
  { concern: "Accessibility", runtime: "yes", scan: "yes", compile: "no" },
  { concern: "Performance", runtime: "yes", scan: "partial", compile: "no" },
  { concern: "Correctness of meaning", runtime: "yes", scan: "no", compile: "no" },
];

function Dot({ cell }: { cell: Cell }) {
  const label = cell === "yes" ? "defended" : cell === "partial" ? "partial" : "not available";
  return <span className={`gg-dot gg-dot-${cell}`} role="img" aria-label={label} />;
}

export default function TierMatrix() {
  return (
    <figure className="gg-root gg-matrix">
      <div className="gg-matrix-grid" role="table" aria-label="Concern by guardrail">
        <div className="gg-matrix-row gg-matrix-head" role="row">
          <div className="gg-matrix-corner" role="columnheader">
            Concern
          </div>
          {COLS.map((c) => (
            <div key={c.key} className="gg-matrix-col" role="columnheader">
              <span className="gg-matrix-col-label">{c.label}</span>
              <span className="gg-matrix-col-tier">{c.tier}</span>
            </div>
          ))}
        </div>

        {ROWS.map((r) => (
          <div
            key={r.concern}
            className={`gg-matrix-row${r.compile === "yes" ? " gg-matrix-row-strong" : ""}`}
            role="row"
          >
            <div className="gg-matrix-concern" role="rowheader">
              {r.concern}
            </div>
            <div className="gg-matrix-cell" role="cell">
              <Dot cell={r.runtime} />
            </div>
            <div className="gg-matrix-cell" role="cell">
              <Dot cell={r.scan} />
            </div>
            <div className="gg-matrix-cell" role="cell">
              <Dot cell={r.compile} />
            </div>
          </div>
        ))}
      </div>
      <figcaption className="gg-caption">
        Where each concern can be defended. Filled is available, hollow is not, half is partial.
        The accented rows reach the type system, and those are the ones worth promoting. Performance
        stops at the scanner. Correctness of meaning never leaves runtime.
      </figcaption>
    </figure>
  );
}
