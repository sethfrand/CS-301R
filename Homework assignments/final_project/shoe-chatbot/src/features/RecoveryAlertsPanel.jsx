import "./recovery-alerts.css";

const sevLabel = {
  high: "High",
  medium: "Moderate",
  low: "Low",
  info: "Info",
};

const sevColorClass = {
  high: "ra-sev-high",
  medium: "ra-sev-medium",
  low: "ra-sev-low",
  info: "ra-sev-info",
};

function fmtDistMeters(meters, units) {
  if (!meters && meters !== 0) return "N/A";
  const val = units === "mi" ? meters / 1609.34 : meters / 1000;
  return `${val.toFixed(1)} ${units === "mi" ? "mi" : "km"}`;
}

function fmtDuration(sec) {
  if (!sec && sec !== 0) return "N/A";
  const s = Number(sec);
  if (!Number.isFinite(s)) return "N/A";
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

export default function RecoveryAlertsPanel({ alerts, units, onAskAboutData }) {
  if (!alerts) {
    return (
      <div className="ra-panel ra-empty">
        <p className="ra-empty-title">Recovery alerts unavailable</p>
        <p className="ra-empty-sub">Connect Garmin data to generate recovery guidance.</p>
      </div>
    );
  }

  const snapshot = alerts.snapshot || {};
  const prioritized = alerts.prioritized_alerts || [];
  const tomorrowWatch = alerts.tomorrow_watch || null;
  const statusClass = `ra-status-${alerts.status || "green"}`;

  return (
    <section className="ra-panel">
      <div className="ra-header">
        <div>
          <h3 className="ra-title">Recovery Alerts</h3>
          <p className="ra-subtitle">Daily readiness and training risk checks</p>
        </div>
        <button
          className="ra-ask-btn"
          onClick={() => onAskAboutData?.("Review my recovery alerts and adjust my next workout intensity.")}
        >
          Ask AI
        </button>
      </div>

      <div className={`ra-status ${statusClass}`}>
        <div className="ra-status-badge">{(alerts.status || "green").toUpperCase()}</div>
        <div className="ra-status-text">{alerts.status_message || "No status message available."}</div>
      </div>

      <div className="ra-snapshot-grid">
        <div className="ra-stat">
          <div className="ra-stat-label">Readiness</div>
          <div className="ra-stat-val">{snapshot.readiness_score ?? "N/A"}</div>
        </div>
        <div className="ra-stat">
          <div className="ra-stat-label">Sleep Last Night</div>
          <div className="ra-stat-val">
            {snapshot.sleep_hours_last != null ? `${snapshot.sleep_hours_last.toFixed(1)}h` : "N/A"}
          </div>
        </div>
        <div className="ra-stat">
          <div className="ra-stat-label">HRV</div>
          <div className="ra-stat-val">
            {snapshot.hrv_last != null ? `${snapshot.hrv_last}` : "N/A"}
          </div>
        </div>
        <div className="ra-stat">
          <div className="ra-stat-label">Stress</div>
          <div className="ra-stat-val">{snapshot.stress_last ?? "N/A"}</div>
        </div>
        <div className="ra-stat">
          <div className="ra-stat-label">Body Battery</div>
          <div className="ra-stat-val">{snapshot.body_battery_last ?? "N/A"}</div>
        </div>
        <div className="ra-stat">
          <div className="ra-stat-label">Sleep 7-Day Avg</div>
          <div className="ra-stat-val">
            {snapshot.sleep_hours_7d_avg != null ? `${snapshot.sleep_hours_7d_avg.toFixed(1)}h` : "N/A"}
          </div>
        </div>
      </div>

      {tomorrowWatch && (
        <div className={`ra-watch ra-watch-${tomorrowWatch.risk || "low"}`}>
          <div className="ra-watch-title">
            {tomorrowWatch.is_tomorrow ? "Tomorrow Watch" : "Next Workout Watch"}
          </div>
          <div className="ra-watch-main">
            {tomorrowWatch.workout_name} on {tomorrowWatch.date}
          </div>
          <div className="ra-watch-meta">
            {fmtDistMeters(tomorrowWatch.estimated_distance_m, units)} · {fmtDuration(tomorrowWatch.estimated_duration_s)}
          </div>
          <div className="ra-watch-rec">{tomorrowWatch.recommendation}</div>
        </div>
      )}

      <div className="ra-alert-list">
        {prioritized.map((alert, idx) => (
          <article key={idx} className={`ra-alert ${sevColorClass[alert.severity] || "ra-sev-info"}`}>
            <div className="ra-alert-top">
              <div className="ra-alert-title">{alert.title || "Alert"}</div>
              <span className="ra-alert-pill">{sevLabel[alert.severity] || "Info"}</span>
            </div>
            <div className="ra-alert-exp">{alert.explanation}</div>
            <div className="ra-alert-rec">Action: {alert.recommendation}</div>
          </article>
        ))}
      </div>
    </section>
  );
}
