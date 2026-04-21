import { useState } from "react";
import "./shoe-rotation.css";

const M_PER_MI = 1609.34;

function formatDistanceMeters(meters, units = "mi", digits = 1) {
  const value = Number(meters || 0);
  if (!Number.isFinite(value)) return "-";
  if (units === "km") return `${(value / 1000).toFixed(digits)} km`;
  return `${(value / M_PER_MI).toFixed(digits)} mi`;
}

function formatPct(v) {
  const n = Number(v || 0);
  if (!Number.isFinite(n)) return "-";
  return `${Math.round(n * 100)}%`;
}

function formatWeightDrop(option) {
  const parts = [];
  if (option?.weight_oz) parts.push(`${Number(option.weight_oz).toFixed(1)} oz`);
  if (option?.drop_mm) parts.push(`${Number(option.drop_mm).toFixed(1)} mm drop`);
  return parts.join(" | ") || "No lab weight/drop";
}

function wearClass(wearPct) {
  const n = Number(wearPct || 0);
  if (n >= 1) return "critical";
  if (n >= 0.85) return "warning";
  if (n >= 0.7) return "watch";
  return "healthy";
}

export default function ShoeRotationPanel({ insight, units = "mi", onAskAboutData }) {
  const summary = insight?.rotation_summary || {};
  const worn = Array.isArray(insight?.worn_shoes) ? insight.worn_shoes : [];
  const underused = Array.isArray(insight?.underused_shoes) ? insight.underused_shoes : [];
  const suggested = Array.isArray(insight?.per_shoe_suggested_use) ? insight.per_shoe_suggested_use : [];
  const replacement = Array.isArray(insight?.replacement_plan) ? insight.replacement_plan[0] : null;
  const options = replacement && Array.isArray(replacement.replacement_options)
    ? replacement.replacement_options
    : [];
  const [replacementIndex, setReplacementIndex] = useState(0);
  const activeIndex = options.length > 0 ? replacementIndex % options.length : 0;
  const activeOption = options.length > 0 ? options[activeIndex] : null;

  if (!insight || typeof insight !== "object") {
    return (
      <section className="rotation-panel">
        <div className="rotation-empty">No shoe rotation insight available yet.</div>
      </section>
    );
  }

  return (
    <section className="rotation-panel">
      <div className="rotation-head">
        <h3>Shoe Rotation Intelligence</h3>
        {onAskAboutData && (
          <button
            className="rotation-ask"
            onClick={() => onAskAboutData("Based on my rotation intelligence panel, build a 2-week shoe usage plan and explain why.")}
          >
            Ask AI
          </button>
        )}
      </div>

      <div className="rotation-kpis">
        <article className="rotation-kpi">
          <span className="label">Active Shoes</span>
          <span className="value">{summary.active_shoe_count ?? 0}</span>
        </article>
        <article className="rotation-kpi">
          <span className="label">Total Logged</span>
          <span className="value">{formatDistanceMeters(summary.total_distance_m, units, 0)}</span>
        </article>
        <article className="rotation-kpi">
          <span className="label">Average Wear</span>
          <span className="value">{formatPct(summary.average_wear_pct)}</span>
        </article>
        <article className="rotation-kpi">
          <span className="label">At Risk</span>
          <span className="value">{summary.worn_shoe_count ?? 0}</span>
        </article>
      </div>

      {replacement && (
        <div className="rotation-card replacement">
          <div className="rotation-card-head">
            <h4>Replacement Recommendation</h4>
            <div className="replacement-head-actions">
              {options.length > 1 && (
                <button
                  className="replacement-refresh"
                  type="button"
                  onClick={() => setReplacementIndex((idx) => (idx + 1) % options.length)}
                >
                  Refresh
                </button>
              )}
              <span className={`wear-chip ${wearClass(replacement.current_wear_pct)}`}>
                {replacement.current_shoe} ({formatPct(replacement.current_wear_pct)})
              </span>
            </div>
          </div>
          <p className="rotation-note">
            Current mileage: {formatDistanceMeters((replacement.current_distance_mi || 0) * M_PER_MI, units, 1)}
          </p>
          <div className="replacement-list">
            {options.length === 0 && <div className="rotation-note">No close replacement found in shoe catalog.</div>}
            {activeOption && (
              <>
                {options.length > 1 && (
                  <div className="rotation-note">
                    Showing option {activeIndex + 1} of {options.length}
                  </div>
                )}
                <article key={`${activeOption.model}-${activeIndex}`} className="replacement-item">
                <div className="line1">
                  <strong>{activeOption.model || "Unknown model"}</strong>
                  <span className="score">Match {Math.round(Number(activeOption.match_score || 0))}</span>
                </div>
                <div className="line2">{formatWeightDrop(activeOption)}</div>
                <div className="line3">
                  {activeOption.support ? `Support: ${activeOption.support}` : "Support: n/a"}
                  {Array.isArray(activeOption.usage_tags) && activeOption.usage_tags.length > 0 ? ` | Use: ${activeOption.usage_tags.join(", ")}` : ""}
                </div>
                {activeOption.url && (
                  <a className="catalog-link" href={activeOption.url} target="_blank" rel="noreferrer">
                    View in catalog
                  </a>
                )}
                </article>
              </>
            )}
          </div>
        </div>
      )}

      <div className="rotation-grid">
        <div className="rotation-card">
          <h4>Worn / Replacement Candidates</h4>
          <div className="shoe-list">
            {worn.length === 0 && <div className="rotation-note">No shoes are currently near retirement.</div>}
            {worn.map((shoe) => (
              <div key={shoe.name} className="shoe-row">
                <div>
                  <div className="shoe-name">{shoe.name}</div>
                  <div className="shoe-meta">
                    {formatDistanceMeters(shoe.distance_m, units, 1)} of {formatDistanceMeters(shoe.retire_distance_m, units, 1)}
                  </div>
                </div>
                <span className={`wear-chip ${wearClass(shoe.wear_pct)}`}>{formatPct(shoe.wear_pct)}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="rotation-card">
          <h4>Underused Shoes</h4>
          <div className="shoe-list">
            {underused.length === 0 && <div className="rotation-note">No clearly underused shoes found.</div>}
            {underused.map((shoe) => (
              <div key={shoe.name} className="shoe-row">
                <div>
                  <div className="shoe-name">{shoe.name}</div>
                  <div className="shoe-meta">
                    {formatDistanceMeters(shoe.distance_m, units, 1)} logged
                  </div>
                </div>
                <span className="usage-chip">{(shoe.usage_tags || []).join(", ") || "general"}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="rotation-card">
        <h4>Per-Shoe Suggested Use</h4>
        <div className="usage-table">
          {suggested.length === 0 && <div className="rotation-note">No per-shoe guidance available.</div>}
          {suggested.map((shoe) => (
            <div key={`use-${shoe.name}`} className="usage-row">
              <div className="usage-name">{shoe.name}</div>
              <div className="usage-text">{shoe.recommended_use || "No recommendation"}</div>
              <div className="usage-metrics">
                {formatDistanceMeters(shoe.distance_m, units, 1)} | wear {formatPct(shoe.wear_pct)}
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
