import LongTermAnalyticsPanel from "../features/LongTermAnalyticsPanel";
import RecoveryAlertsPanel from "../features/RecoveryAlertsPanel";
import ShoeRotationPanel from "../features/ShoeRotationPanel";
import ShoeDecisionPanel from "../features/ShoeDecisionPanel";
import { distanceLabel, formatDistance, formatPace, formatSleep, paceLabel } from "../lib/formatters";

function formatLocalIso(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function dayKey(value) {
  if (!value) return null;
  const raw = String(value).slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : null;
}

function getWeekStart(dateString) {
  const rawDate = dayKey(dateString) || "";
  if (!rawDate) return null;
  const date = new Date(`${rawDate}T00:00:00`);
  if (Number.isNaN(date.getTime())) return null;
  date.setDate(date.getDate() - date.getDay() + (date.getDay() === 0 ? -6 : 1));
  return formatLocalIso(date);
}

function parseRunTimestamp(value) {
  if (!value) return null;
  const raw = String(value).trim();
  if (!raw) return null;
  const normalized = raw.includes(" ") && !raw.includes("T") ? raw.replace(" ", "T") : raw;
  const parsed = Date.parse(normalized);
  if (!Number.isNaN(parsed)) return parsed;
  const day = dayKey(raw);
  return day ? Date.parse(`${day}T00:00:00`) : null;
}

function latestRunTimestamp(data) {
  const timestamps = (data?.recent_runs || [])
    .map((run) => parseRunTimestamp(run?.start_time))
    .filter((value) => Number.isFinite(value));
  return timestamps.length ? Math.max(...timestamps) : null;
}

function pickRunData(strava, garmin) {
  const candidates = [strava, garmin].filter(Boolean);
  if (!candidates.length) return null;

  return [...candidates].sort((left, right) => {
    const rightLatest = latestRunTimestamp(right) ?? -1;
    const leftLatest = latestRunTimestamp(left) ?? -1;
    if (rightLatest !== leftLatest) return rightLatest - leftLatest;

    const rightRuns = right?.recent_runs?.length || 0;
    const leftRuns = left?.recent_runs?.length || 0;
    if (rightRuns !== leftRuns) return rightRuns - leftRuns;

    return (right?.weekly_trend?.length || 0) - (left?.weekly_trend?.length || 0);
  })[0];
}

function Sparkline({ data, color = "var(--accent)", height = 40, fill = true }) {
  if (!data || data.length < 2) return <div style={{ height }} className="chart-empty">—</div>;
  const max = Math.max(...data);
  const min = Math.min(...data);
  const range = max - min || 1;
  const width = 200;
  const points = data.map((value, index) => {
    const x = (index / (data.length - 1)) * width;
    const y = height - ((value - min) / range) * (height - 4) - 2;
    return `${x},${y}`;
  });
  const polyline = points.join(" ");
  const area = `${points[0].split(",")[0]},${height} ${polyline} ${points[points.length - 1].split(",")[0]},${height}`;

  return (
    <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" style={{ width: "100%", height }}>
      {fill && <polygon points={area} fill={color} opacity="0.12" />}
      <polyline points={polyline} fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function SleepBar({ sleep }) {
  if (!sleep) return null;
  const total = (sleep.deep_s || 0) + (sleep.light_s || 0) + (sleep.rem_s || 0) + (sleep.awake_s || 0);
  if (!total) return null;
  const widthPct = (value) => `${Math.round((value / total) * 100)}%`;

  return (
    <div className="sleep-bar">
      <div style={{ width: widthPct(sleep.deep_s || 0), background: "#4f46e5" }} title={`Deep: ${formatSleep(sleep.deep_s)}`} />
      <div style={{ width: widthPct(sleep.rem_s || 0), background: "#7c3aed" }} title={`REM: ${formatSleep(sleep.rem_s)}`} />
      <div style={{ width: widthPct(sleep.light_s || 0), background: "#a78bfa" }} title={`Light: ${formatSleep(sleep.light_s)}`} />
      <div style={{ width: widthPct(sleep.awake_s || 0), background: "var(--surface2)" }} title={`Awake: ${formatSleep(sleep.awake_s)}`} />
    </div>
  );
}

function StatCard({ label, value, unit, sub, accent, warn, trend }) {
  return (
    <div className={`stat-card ${accent ? "accent" : ""} ${warn ? "warn" : ""}`}>
      <div className="stat-label">{label}</div>
      <div className="stat-value">
        {value != null ? (
          <>
            {value}
            <span className="stat-unit">{unit ? ` ${unit}` : ""}</span>
          </>
        ) : (
          <span className="stat-empty">—</span>
        )}
      </div>
      {sub && <div className="stat-sub">{sub}</div>}
      {trend && <Sparkline data={trend} color={accent ? "var(--accent)" : warn ? "var(--warn)" : "var(--muted)"} height={28} />}
    </div>
  );
}

function ShoeCard({ shoe, units }) {
  const distance = formatDistance(shoe.distance || 0, units, 0);
  const retireDistance = formatDistance(shoe.retire_distance || 800000, units, 0);
  const wearPct = Math.min(100, Math.round(((shoe.distance || 0) / (shoe.retire_distance || 800000)) * 100));

  return (
    <div className={`shoe-card ${wearPct > 80 ? "worn" : ""}`}>
      <div className="shoe-header">
        <span className="shoe-name">{shoe.name || "Unknown"}</span>
        {shoe.primary && <span className="shoe-badge">Primary</span>}
        {wearPct > 80 && <span className="shoe-badge warn">Replace Soon</span>}
      </div>
      <div className="shoe-mileage-row">
        <span className="shoe-km">{distance} {distanceLabel(units)}</span>
        <span className="shoe-retire"> / {retireDistance} {distanceLabel(units)}</span>
      </div>
      <div className="shoe-bar-bg">
        <div className="shoe-bar-fill" style={{ width: `${wearPct}%`, background: wearPct > 80 ? "var(--warn)" : "var(--accent)" }} />
      </div>
    </div>
  );
}

function ActivityRow({ activity, units }) {
  const activityDay = dayKey(activity.start_time);
  const dateLabel = activityDay
    ? new Date(`${activityDay}T00:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric" })
    : "—";
  const distance = formatDistance(activity.distance, units, 2);
  const pace = formatPace(activity.distance, activity.duration_in_seconds, units);
  const stats = [
    `${distance} ${distanceLabel(units)}`,
    `${pace}${paceLabel(units)}`,
    activity.average_heartrate ? `${Math.round(activity.average_heartrate)} bpm` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <div className="activity-row">
      <div className="activity-date">{dateLabel}</div>
      <div className="activity-name">{activity.name || "Run"}</div>
      <div className="activity-stats">{stats}</div>
    </div>
  );
}

export default function Dashboard({ athleteData, insights, token, onAskAboutData, units }) {
  const strava = athleteData?.strava;
  const garmin = athleteData?.garmin;
  const runData = pickRunData(
    (strava?.weekly_trend?.length || strava?.recent_runs?.length) ? strava : null,
    (garmin?.weekly_trend?.length || garmin?.recent_runs?.length) ? garmin : null,
  );

  if (!strava && !garmin) {
    return (
      <div className="dashboard-empty">
        <svg width="52" height="52" viewBox="0 0 52 52" fill="none" style={{ opacity: 0.3 }}>
          <circle cx="26" cy="26" r="22" stroke="var(--border)" strokeWidth="1.5" strokeDasharray="5 3" />
          <path d="M14 36 Q19 18 26 23 Q33 28 38 10" stroke="var(--muted)" strokeWidth="2.5" strokeLinecap="round" />
        </svg>
        <p className="empty-title">No data yet</p>
        <p className="empty-sub">Connect Strava or Intervals.icu in the Connect tab.</p>
      </div>
    );
  }

  const allRuns = [...(runData?.recent_runs || [])].sort((left, right) => {
    const rightTime = parseRunTimestamp(right.start_time) ?? 0;
    const leftTime = parseRunTimestamp(left.start_time) ?? 0;
    return rightTime - leftTime;
  });
  const weeklyTrend = runData?.weekly_trend || [];
  const trendValues = weeklyTrend.map((entry) => Number(formatDistance(entry.distance_m, units, 1)));
  const trendLabels = weeklyTrend.map((entry) => entry.week?.slice(5));
  const currentWeekEntry = weeklyTrend.length ? weeklyTrend[weeklyTrend.length - 1] : null;
  const previousWeekEntry = weeklyTrend.length > 1 ? weeklyTrend[weeklyTrend.length - 2] : null;
  const weekDistance = currentWeekEntry ? formatDistance(currentWeekEntry.distance_m, units, 1) : null;
  const currentWeekStart = currentWeekEntry?.week ?? null;
  const weekRuns = currentWeekStart
    ? allRuns.filter((run) => {
        return getWeekStart(run.start_time) === currentWeekStart;
      }).length
    : null;
  const weeklyMeters = weeklyTrend.map((entry) => Number(entry.distance_m || 0));
  const fourWeekAverageMeters = weeklyMeters.length
    ? weeklyMeters.slice(-4).reduce((sum, value) => sum + value, 0) / Math.min(4, weeklyMeters.length)
    : null;
  const peakWeekMeters = weeklyMeters.length ? Math.max(...weeklyMeters) : null;
  const averageRunsPerWeek = weeklyTrend.length
    ? allRuns.length / weeklyTrend.length
    : null;
  const weekDeltaMeters = currentWeekEntry && previousWeekEntry
    ? Number(currentWeekEntry.distance_m || 0) - Number(previousWeekEntry.distance_m || 0)
    : null;

  const bodyBattery = garmin?.body_battery || [];
  const bodyBatteryValues = bodyBattery.map((entry) => entry.end_level || 0).filter(Boolean);
  const sleepData = garmin?.sleep || [];
  const averageSleep = sleepData.length
    ? sleepData.reduce((sum, entry) => sum + (entry.duration_s || 0), 0) / sleepData.length / 3600
    : null;
  const stressData = garmin?.stress || [];
  const stressValues = stressData.map((entry) => entry.avg_stress || 0).filter(Boolean);
  const averageStress = stressValues.length ? Math.round(stressValues.reduce((sum, value) => sum + value, 0) / stressValues.length) : null;

  const statCards = [
    weekDistance != null && { label: "Distance", value: weekDistance, unit: distanceLabel(units), accent: true },
    weekRuns != null && { label: "Runs", value: weekRuns },
    garmin?.vo2max != null && { label: "VO2 Max", value: Number(garmin.vo2max).toFixed(1), sub: garmin.training_status_phrase },
    garmin?.resting_hr != null && { label: "Resting HR", value: garmin.resting_hr, unit: "bpm" },
    garmin?.total_steps != null && { label: "Steps", value: garmin.total_steps.toLocaleString() },
    garmin?.recovery_time != null && { label: "Recovery", value: `${garmin.recovery_time}h` },
    garmin?.hrv != null && { label: "HRV", value: garmin.hrv },
    garmin?.endurance_score != null && { label: "Endurance", value: garmin.endurance_score },
  ].filter(Boolean);

  return (
    <div className="dashboard">
      {statCards.length > 0 && (
        <div className="dashboard-section">
          <div className="section-header"><h3 className="section-title">This Week</h3></div>
          <div className="stats-grid">
            {statCards.map((card, index) => <StatCard key={index} {...card} />)}
          </div>
        </div>
      )}

      {trendValues.length > 1 && (
        <div className="dashboard-section">
          <h3 className="section-title">Weekly Mileage — 12 Weeks</h3>
          <div className="chart-card">
            <div className="chart-stat-row">
              <div className="chart-stat-pill">
                <span>Current</span>
                <strong>{weekDistance ?? "—"} {distanceLabel(units)}</strong>
              </div>
              <div className="chart-stat-pill">
                <span>4-Week Avg</span>
                <strong>{fourWeekAverageMeters != null ? `${formatDistance(fourWeekAverageMeters, units, 1)} ${distanceLabel(units)}` : "—"}</strong>
              </div>
              <div className="chart-stat-pill">
                <span>Peak</span>
                <strong>{peakWeekMeters != null ? `${formatDistance(peakWeekMeters, units, 1)} ${distanceLabel(units)}` : "—"}</strong>
              </div>
              <div className="chart-stat-pill">
                <span>Delta</span>
                <strong>
                  {weekDeltaMeters != null
                    ? `${weekDeltaMeters >= 0 ? "+" : ""}${formatDistance(Math.abs(weekDeltaMeters), units, 1)} ${distanceLabel(units)}`
                    : "—"}
                </strong>
              </div>
              <div className="chart-stat-pill">
                <span>Avg Runs/Wk</span>
                <strong>{averageRunsPerWeek != null ? averageRunsPerWeek.toFixed(1) : "—"}</strong>
              </div>
            </div>
            <div className="chart-header-row">
              {trendValues.map((value, index) => (
                <div key={`${trendLabels[index]}-${index}`} className="chart-col">
                  <div className="chart-bar-wrap">
                    <div
                      className="chart-bar-fill"
                      style={{
                        height: `${(value / Math.max(...trendValues)) * 100}%`,
                        background: index === trendValues.length - 1 ? "var(--accent)" : "var(--surface2)",
                        border: index === trendValues.length - 1 ? "none" : "1px solid var(--border)",
                      }}
                    />
                  </div>
                  <div className="chart-val">{value}</div>
                  <div className="chart-lbl">{trendLabels[index]}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {insights?.long_term_analytics && (
        <LongTermAnalyticsPanel analytics={insights.long_term_analytics} units={units} onAskAboutData={onAskAboutData} />
      )}

      {(bodyBatteryValues.length > 0 || sleepData.length > 0 || stressValues.length > 0) && (
        <div className="dashboard-section">
          <h3 className="section-title">Recovery Metrics</h3>
          <div className="stats-grid-3">
            {bodyBatteryValues.length > 0 && (
              <div className="metric-chart-card">
                <div className="metric-chart-label">Body Battery</div>
                <div className="metric-chart-value">{bodyBatteryValues[bodyBatteryValues.length - 1]}<span className="stat-unit"> / 100</span></div>
                <Sparkline data={bodyBatteryValues} color="var(--accent)" height={44} />
              </div>
            )}
            {averageSleep && (
              <div className="metric-chart-card">
                <div className="metric-chart-label">Avg Sleep</div>
                <div className="metric-chart-value">{averageSleep.toFixed(1)}<span className="stat-unit">h</span></div>
                <Sparkline data={sleepData.map((entry) => (entry.duration_s || 0) / 3600)} color="#7c3aed" height={44} />
              </div>
            )}
            {averageStress != null && (
              <div className="metric-chart-card">
                <div className="metric-chart-label">Avg Stress</div>
                <div className="metric-chart-value" style={{ color: averageStress > 50 ? "var(--warn)" : undefined }}>
                  {averageStress}<span className="stat-unit"> / 100</span>
                </div>
                <Sparkline data={stressValues} color="var(--warn)" height={44} />
              </div>
            )}
          </div>
        </div>
      )}

      {sleepData.length > 0 && (
        <div className="dashboard-section">
          <h3 className="section-title">Sleep — Last 14 Days</h3>
          <div className="sleep-list">
            {sleepData.slice(-7).map((sleep, index) => (
              <div key={`${sleep.date || "sleep"}-${index}`} className="sleep-row">
                <div className="sleep-date">{new Date(sleep.date).toLocaleDateString("en-US", { month: "short", day: "numeric" })}</div>
                <div className="sleep-duration">{formatSleep(sleep.duration_s)}</div>
                <div className="sleep-bar-wrap"><SleepBar sleep={sleep} /></div>
                <div className="sleep-score">{sleep.score ? `${sleep.score}` : ""}</div>
              </div>
            ))}
            {sleepData.some((sleep) => sleep.deep_s || sleep.rem_s || sleep.light_s) && (
              <div className="sleep-legend">
                <span><i style={{ background: "#4f46e5" }} /> Deep</span>
                <span><i style={{ background: "#7c3aed" }} /> REM</span>
                <span><i style={{ background: "#a78bfa" }} /> Light</span>
                <span><i style={{ background: "var(--surface2)" }} /> Awake</span>
              </div>
            )}
          </div>
        </div>
      )}

      {strava?.shoes?.length > 0 && (
        <div className="dashboard-section">
          <div className="section-header">
            <h3 className="section-title">Shoe Rotation</h3>
            <button className="ask-btn" onClick={() => onAskAboutData("Analyze my shoe rotation and tell me if I should retire any shoes or add a new one.")}>
              Ask AI ↗
            </button>
          </div>
          <div className="shoes-grid">{strava.shoes.map((shoe) => <ShoeCard key={shoe.id} shoe={shoe} units={units} />)}</div>
        </div>
      )}

      {insights?.shoe_rotation && (
        <ShoeRotationPanel insight={insights.shoe_rotation} units={units} onAskAboutData={onAskAboutData} />
      )}

      <ShoeDecisionPanel token={token} athleteData={athleteData} insights={insights} onAskAboutData={onAskAboutData} />

      {allRuns.length > 0 && (
        <div className="dashboard-section">
          <div className="section-header">
            <h3 className="section-title">Recent Runs</h3>
            <button className="ask-btn" onClick={() => onAskAboutData("Based on my recent runs and training load, what shoe would best support my training?")}>
              Ask AI ↗
            </button>
          </div>
          <div className="activity-list">
            {allRuns.slice(0, 12).map((activity, index) => <ActivityRow key={`${activity.start_time || "run"}-${index}`} activity={activity} units={units} />)}
          </div>
        </div>
      )}

      {insights?.recovery_alerts && (
        <RecoveryAlertsPanel alerts={insights.recovery_alerts} units={units} onAskAboutData={onAskAboutData} />
      )}
    </div>
  );
}
