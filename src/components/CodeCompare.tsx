import "./guardrail-tiers.css";

type Tone = "danger" | "warn" | "safe" | "neutral";

export interface ComparePane {
  /** Heading for the pane, e.g. "Lint rule" or "Phantom type". */
  title: string;
  /** Small mono subtitle, e.g. "tier two". Optional. */
  tier?: string;
  /** Verdict chip text, e.g. "leak impossible". */
  verdict: string;
  /** Chip color. */
  verdictTone: Tone;
  /** Raw code. Leading/trailing blank lines are trimmed. */
  code: string;
  /** 1-indexed line number -> tint tone, e.g. { 2: "danger", 3: "safe" }. */
  mark?: Record<number, Tone>;
}

export interface CodeCompareProps {
  before: ComparePane;
  after: ComparePane;
  caption?: string;
}

/** Split a line into [code, comment] at the first `//`. Heuristic, fine for
 *  hand-written snippets; it does not understand `//` inside string literals. */
function splitComment(line: string): [string, string] {
  const idx = line.indexOf("//");
  if (idx === -1) return [line, ""];
  return [line.slice(0, idx), line.slice(idx)];
}

function Pane({ pane }: { pane: ComparePane }) {
  const lines = pane.code.replace(/^\n+|\n+$/g, "").split("\n");
  return (
    <div className="gg-pane">
      <div className="gg-pane-head">
        <span className="gg-pane-titles">
          <span className="gg-pane-title">{pane.title}</span>
          {pane.tier ? <span className="gg-pane-tier">{pane.tier}</span> : null}
        </span>
        <span className={`gg-chip gg-chip-${pane.verdictTone}`}>{pane.verdict}</span>
      </div>
      <pre className="gg-code">
        <code>
          {lines.map((line, i) => {
            const tone = pane.mark?.[i + 1];
            const [codePart, commentPart] = splitComment(line);
            return (
              <span key={i} className={`gg-line${tone ? ` gg-line-${tone}` : ""}`}>
                <span className="gg-line-num">{i + 1}</span>
                <span className="gg-line-text">
                  {codePart || (commentPart ? "" : "\u00A0")}
                  {commentPart ? <span className="gg-comment">{commentPart}</span> : null}
                </span>
              </span>
            );
          })}
        </code>
      </pre>
    </div>
  );
}

export default function CodeCompare({ before, after, caption }: CodeCompareProps) {
  return (
    <figure className="gg-root gg-compare">
      <div className="gg-compare-grid">
        <Pane pane={before} />
        <div className="gg-compare-arrow" aria-hidden="true">
          &rarr;
        </div>
        <Pane pane={after} />
      </div>
      {caption ? <figcaption className="gg-caption">{caption}</figcaption> : null}
    </figure>
  );
}
