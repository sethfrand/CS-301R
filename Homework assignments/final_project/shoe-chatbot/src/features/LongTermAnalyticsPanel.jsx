import "./long-term-analytics.css";

const M_PER_MI = 1609.34;

function fmtDistMeters(meters, units = "mi", decimals = 1) {
  if (meters == null || Number.isNaN(Number(meters))) return "—";
  const m = Number(meters);
  if (units === "km") return `${(m / 1000).toFixed(decimals)} km`;
  return `${(m / M_PER_MI).toFixed(decimals)} mi`;
}

function fmtPace(secPerMile, units = "mi") {
  if (!secPerMile || Number.isNaN(Number(secPerMile))) return "—";
  const sec = units === "km" ? Number(secPerMile) / 1.60934 : Number(secPerMile);
  const mm = Math.floor(sec / 60);
  const ss = Math.round(sec % 60);
  return `${mm}:${String(ss).padStart(2, "0")} /${units === "km" ? "km" : "mi"}`;
}

function fmtTimeFromSeconds(totalSeconds) {
  if (!totalSeconds || Number.isNaN(Number(totalSeconds))) return "—";
  const sec = Number(totalSeconds);
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}` : `${m}:${String(s).padStart(2, "0")}`;
}

function titleizeDistanceKey(key) {
  if (!key) return "—";
  const map = {
    mile: "Mile",
    "5k": "5K",
    "10k": "10K",
    halfmarathon: "Half",
    marathon: "Marathon",
  };
  return map[String(key).toLowerCase()] || key;
}

function WeeklyDistanceBars({ weeks = [], units = "mi" }) {
  if (!weeks.length) return <div className="lta-empty">No weekly trend data.</div>;
  const maxVal = Math.max(...weeks.map(w => Number(w.distance_m || 0)), 1);
  return (
    <div className="lta-bars">
      {weeks.map((w, idx) => {
        const val = Number(w.distance_m || 0);
        const pct = Math.max(3, Math.round((val / maxVal) * 100));
        const isLatest = idx === weeks.length - 1;
        return (
          <div key={`${w.week}-${idx}`} className="lta-bar-col">
            <div className="lta-bar-wrap">
              <div className={`lta-bar-fill ${isLatest ? "latest" : ""}`} style={{ height: `${pct}%` }} />
            </div>
            <div className="lta-bar-value">{fmtDistMeters(val, units, 1)}</div>
            <div className="lta-bar-label">{String(w.week || "").slice(5)}</div>
          </div>
        );
      })}
    </div>
  );
}

export default function LongTermAnalyticsPanel({ analytics, units = "mi", onAskAboutData }) {
  if (!analytics) {
    return (
      <div className="lta-panel lta-panel-empty">
        <p className="lta-empty-title">Long-term analytics unavailable</p>
        <p className="lta-empty-sub">Connect Garmin and refresh data to unlock trend insights.</p>
      </div>
    );
  }

  const weekTrend = analytics.week_trend || {};
  const consistency = analytics.consistency || {};
  const pace = analytics.pace_efficiency || {};
  const race = analytics.race_predictions || {};
  const pr = analytics.pr_progress || {};
  const bullets = analytics.bullets || [];
  const bestPrWindow = race.best_pr_window;
  const prRows = pr.progression || [];

  const trendDirection = weekTrend.trend_direction || "flat";
  const trendTone = trendDirection === "up" ? "good" : trendDirection === "down" ? "warn" : "neutral";
  const delta = weekTrend.delta_m;

  return (
    <div className="lta-panel">
      <div className="lta-header">
        <h3 className="lta-title">Long-Term Analytics</h3>
        {onAskAboutData && (
          <button
            className="lta-ask-btn"
            onClick={() => onAskAboutData("Analyze my long-term trends and tell me how to adjust training and shoe choices this month.")}
          >
            Ask AI ↗
          </button>
        )}
      </div>

      <div className="lta-kpi-grid">
        <div className={`lta-kpi-card ${trendTone}`}>
          <div className="lta-kpi-label">Current Week</div>
          <div className="lta-kpi-value">{fmtDistMeters(weekTrend.current_week_m || 0, units, 1)}</div>
          <div className="lta-kpi-sub">
            {delta == null ? "No prior week to compare" : `${delta >= 0 ? "+" : ""}${fmtDistMeters(Math.abs(delta), units, 1)} vs last week`}
          </div>
        </div>
        <div className="lta-kpi-card">
          <div className="lta-kpi-label">4-Week Avg</div>
          <div className="lta-kpi-value">{fmtDistMeters(consistency.rolling_4wk_avg_m || 0, units, 1)}</div>
          <div className="lta-kpi-sub">{Math.round((consistency.consistency_ratio || 0) * 100)}% active-week consistency</div>
        </div>
        <div className="lta-kpi-card">
          <div className="lta-kpi-label">Streak</div>
          <div className="lta-kpi-value">{consistency.current_streak_weeks || 0} wk</div>
          <div className="lta-kpi-sub">Best streak: {consistency.longest_streak_weeks || 0} wk</div>
        </div>
        <div className="lta-kpi-card">
          <div className="lta-kpi-label">Recent Pace</div>
          <div className="lta-kpi-value">{fmtPace(pace.recent_avg_pace_sec_per_mi, units)}</div>
          <div className="lta-kpi-sub">
            {pace.pace_delta_sec_per_mi == null
              ? "Baseline unavailable"
              : `${pace.pace_delta_sec_per_mi <= 0 ? "Faster" : "Slower"} by ${Math.abs(Math.round(pace.pace_delta_sec_per_mi))} sec/${units === "km" ? "km" : "mi"}`}
          </div>
        </div>
      </div>

      <div className="lta-chart-card">
        <div className="lta-section-head">
          <div className="lta-section-title">Weekly Distance Trend</div>
          <div className="lta-section-note">{weekTrend.interpretation || "No trend interpretation yet."}</div>
        </div>
        <WeeklyDistanceBars weeks={weekTrend.weeks || []} units={units} />
      </div>

      <div className="lta-two-col">
        <div className="lta-card">
          <div className="lta-section-title">Race Prediction Outlook</div>
          {bestPrWindow ? (
            <div className="lta-race-highlight">
              <div className="lta-race-label">{titleizeDistanceKey(bestPrWindow.distance)}</div>
              <div className="lta-race-time">{bestPrWindow.predicted_time || fmtTimeFromSeconds(bestPrWindow.predicted_seconds)}</div>
              <div className="lta-race-sub">
                Potential PR window: {fmtTimeFromSeconds(bestPrWindow.potential_pr_delta_seconds)} faster than current PR
              </div>
            </div>
          ) : (
            <div className="lta-empty">No clear PR window from current predictions.</div>
          )}
        </div>

        <div className="lta-card">
          <div className="lta-section-title">Pace & Efficiency</div>
          <div className="lta-mini-list">
            <div className="lta-mini-row">
              <span>Runs analyzed</span>
              <strong>{pace.run_count || 0}</strong>
            </div>
            <div className="lta-mini-row">
              <span>Recent pace</span>
              <strong>{fmtPace(pace.recent_avg_pace_sec_per_mi, units)}</strong>
            </div>
            <div className="lta-mini-row">
              <span>Baseline pace</span>
              <strong>{fmtPace(pace.baseline_avg_pace_sec_per_mi, units)}</strong>
            </div>
            <div className="lta-mini-row">
              <span>Efficiency proxy</span>
              <strong>{pace.efficiency_score ? pace.efficiency_score.toFixed(4) : "—"}</strong>
            </div>
          </div>
          <div className="lta-note">{pace.interpretation || "Not enough data for pace interpretation."}</div>
        </div>
      </div>

      <div className="lta-card">
        <div className="lta-section-title">PR Progress</div>
        {prRows.length ? (
          <div className="lta-pr-grid">
            {prRows.map((row, idx) => (
              <div key={`${row.distance}-${idx}`} className="lta-pr-card">
                <div className="lta-pr-dist">{titleizeDistanceKey(row.distance)}</div>
                <div className="lta-pr-time">{row.best_time || fmtTimeFromSeconds(row.best_seconds)}</div>
                <div className="lta-pr-meta">Latest: {row.latest_time || fmtTimeFromSeconds(row.latest_seconds)}</div>
              </div>
            ))}
          </div>
        ) : (
          <div className="lta-empty">No PR progression data available.</div>
        )}
      </div>

      {!!bullets.length && (
        <div className="lta-card">
          <div className="lta-section-title">Coaching Notes</div>
          <ul className="lta-bullets">
            {bullets.map((item, idx) => (
              <li key={idx}>{item}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
