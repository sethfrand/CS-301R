import { useState } from "react";
import RecoveryAlertsPanel from "../features/RecoveryAlertsPanel";

const M_PER_MI = 1609.34;
const DAY_MS = 24 * 60 * 60 * 1000;

function formatLocalIso(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function average(values) {
  const nums = values.filter((value) => Number.isFinite(value));
  return nums.length ? nums.reduce((sum, value) => sum + value, 0) / nums.length : null;
}

function rollingAverage(values, windowSize) {
  return values.map((_, index) => {
    const start = Math.max(0, index - windowSize + 1);
    return average(values.slice(start, index + 1));
  });
}

function median(values) {
  const nums = values.filter((value) => Number.isFinite(value)).sort((left, right) => left - right);
  if (!nums.length) return null;
  const middle = Math.floor(nums.length / 2);
  return nums.length % 2 ? nums[middle] : (nums[middle - 1] + nums[middle]) / 2;
}

function pearsonCorrelation(xs, ys) {
  if (xs.length < 3 || ys.length < 3 || xs.length !== ys.length) return null;
  const meanX = average(xs);
  const meanY = average(ys);
  if (meanX == null || meanY == null) return null;
  let numerator = 0;
  let denomX = 0;
  let denomY = 0;
  xs.forEach((x, index) => {
    const dx = x - meanX;
    const dy = ys[index] - meanY;
    numerator += dx * dy;
    denomX += dx * dx;
    denomY += dy * dy;
  });
  if (!denomX || !denomY) return null;
  return numerator / Math.sqrt(denomX * denomY);
}

function parseDay(value) {
  if (!value) return null;
  const raw = String(value).slice(0, 10);
  const date = new Date(`${raw}T00:00:00`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function dayKey(value) {
  if (!value) return null;
  const raw = String(value).slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : null;
}

function dayLabel(value) {
  return String(value || "").slice(5) || "—";
}

function createDayRange(days) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Array.from({ length: days }, (_, index) => {
    const date = new Date(today);
    date.setDate(today.getDate() - (days - 1 - index));
    return {
      date,
      key: formatLocalIso(date),
      label: formatLocalIso(date).slice(5, 10),
    };
  });
}

function formatRaceTime(value) {
  if (value == null || value === "") return "—";

  let seconds;
  if (typeof value === "string" && value.includes(":")) {
    const parts = value.split(":").map(Number);
    seconds = parts.length === 3
      ? parts[0] * 3600 + parts[1] * 60 + parts[2]
      : parts[0] * 60 + parts[1];
  } else {
    seconds = typeof value === "number" ? value : parseInt(value, 10);
  }

  if (!seconds || Number.isNaN(seconds)) return "—";
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainingSeconds = seconds % 60;
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, "0")}:${String(remainingSeconds).padStart(2, "0")}`
    : `${minutes}:${String(remainingSeconds).padStart(2, "0")}`;
}

function formatValue(value, decimals = 0, suffix = "") {
  if (value == null || !Number.isFinite(value)) return "—";
  return `${value.toFixed(decimals)}${suffix}`;
}

function formatSignedPercent(value) {
  if (value == null || !Number.isFinite(value)) return "—";
  return `${value >= 0 ? "+" : ""}${value.toFixed(0)}%`;
}

function formatSignedNumber(value, decimals = 0) {
  if (value == null || !Number.isFinite(value)) return "—";
  return `${value >= 0 ? "+" : ""}${value.toFixed(decimals)}`;
}

function buildPath(values, width, height, minValue, maxValue) {
  if (!values.length) return "";
  const range = maxValue - minValue || 1;
  return values
    .map((value, index) => {
      const x = values.length === 1 ? width / 2 : (index / (values.length - 1)) * width;
      const y = height - ((value - minValue) / range) * (height - 12) - 6;
      return `${x},${y}`;
    })
    .join(" ");
}

function MultiLineChart({ series, labels, height = 150, valueFormatter = (value) => formatValue(value, 0) }) {
  const [activeIndex, setActiveIndex] = useState(null);
  const validSeries = (series || []).filter((entry) => Array.isArray(entry.data) && entry.data.some((value) => Number.isFinite(value)));
  if (!validSeries.length) return <div className="chart-empty" style={{ height }}>—</div>;
  const values = validSeries.flatMap((entry) => entry.data.filter((value) => Number.isFinite(value)));
  const minValue = Math.min(...values);
  const maxValue = Math.max(...values);
  const width = 320;
  const pointCount = Math.max(...validSeries.map((entry) => entry.data.length), labels?.length || 0);
  const zeroY = minValue < 0 && maxValue > 0
    ? height - ((0 - minValue) / (maxValue - minValue || 1)) * (height - 12) - 6
    : null;
  const resolvedIndex = activeIndex ?? Math.max(0, pointCount - 1);
  const xForIndex = pointCount <= 1 ? width / 2 : (resolvedIndex / (pointCount - 1)) * width;
  const yForValue = (value) => height - ((value - minValue) / (maxValue - minValue || 1)) * (height - 12) - 6;

  function handlePointerMove(event) {
    const rect = event.currentTarget.getBoundingClientRect();
    const ratio = rect.width ? clamp((event.clientX - rect.left) / rect.width, 0, 1) : 0;
    const nextIndex = Math.round(ratio * Math.max(0, pointCount - 1));
    setActiveIndex(nextIndex);
  }

  return (
    <div className="training-chart-shell">
      <div className="training-trace-pill">
        <strong>{labels?.[resolvedIndex] || "—"}</strong>
        {validSeries.map((entry) => {
          const value = entry.data[resolvedIndex];
          return (
            <span key={entry.label}>
              <i style={{ background: entry.color }} />
              {entry.label}: {Number.isFinite(value) ? valueFormatter(value) : "—"}
            </span>
          );
        })}
      </div>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="none"
        className="training-line-chart"
        onMouseMove={handlePointerMove}
        onMouseLeave={() => setActiveIndex(null)}
      >
        {zeroY != null && <line x1="0" y1={zeroY} x2={width} y2={zeroY} className="training-zero-line" />}
        <line x1={xForIndex} y1="0" x2={xForIndex} y2={height} className="training-trace-line" />
        {validSeries.map((entry) => (
          <g key={entry.label}>
            <polyline
              points={buildPath(entry.data, width, height, minValue, maxValue)}
              fill="none"
              stroke={entry.color}
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            {Number.isFinite(entry.data[resolvedIndex]) && (
              <circle
                cx={xForIndex}
                cy={yForValue(entry.data[resolvedIndex])}
                r="4"
                fill={entry.color}
                className="training-trace-point"
              />
            )}
          </g>
        ))}
        <rect x="0" y="0" width={width} height={height} fill="transparent" />
      </svg>
      <div className="training-chart-legend">
        {validSeries.map((entry) => (
          <span key={entry.label}><i style={{ background: entry.color }} />{entry.label}</span>
        ))}
      </div>
      {labels?.length > 1 && (
        <div className="training-axis-labels">
          <span>{labels[0]}</span>
          <span>{labels[Math.floor(labels.length / 2)]}</span>
          <span>{labels[labels.length - 1]}</span>
        </div>
      )}
    </div>
  );
}

function ScatterChart({ points, xLabel, yLabel, valueFormatter }) {
  const [activeIndex, setActiveIndex] = useState(null);
  const validPoints = (points || []).filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y));
  if (!validPoints.length) return <div className="chart-empty" style={{ height: 180 }}>—</div>;
  const width = 320;
  const height = 180;
  const minX = Math.min(...validPoints.map((point) => point.x));
  const maxX = Math.max(...validPoints.map((point) => point.x));
  const minY = Math.min(...validPoints.map((point) => point.y));
  const maxY = Math.max(...validPoints.map((point) => point.y));

  const scaleX = (value) => 18 + ((value - minX) / (maxX - minX || 1)) * (width - 36);
  const scaleY = (value) => height - 18 - ((value - minY) / (maxY - minY || 1)) * (height - 36);
  const resolvedIndex = activeIndex ?? validPoints.length - 1;
  const activePoint = validPoints[resolvedIndex];

  function handlePointerMove(event) {
    const rect = event.currentTarget.getBoundingClientRect();
    const pointerX = rect.width ? ((event.clientX - rect.left) / rect.width) * width : 0;
    const pointerY = rect.height ? ((event.clientY - rect.top) / rect.height) * height : 0;
    let nearestIndex = 0;
    let nearestDistance = Number.POSITIVE_INFINITY;

    validPoints.forEach((point, index) => {
      const dx = scaleX(point.x) - pointerX;
      const dy = scaleY(point.y) - pointerY;
      const distance = dx * dx + dy * dy;
      if (distance < nearestDistance) {
        nearestDistance = distance;
        nearestIndex = index;
      }
    });

    setActiveIndex(nearestIndex);
  }

  return (
    <div className="training-chart-shell">
      <div className="training-trace-pill">
        <strong>{activePoint?.label || "—"}</strong>
        <span>{activePoint ? (valueFormatter ? valueFormatter(activePoint) : `${activePoint.x}, ${activePoint.y}`) : "—"}</span>
      </div>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="none"
        className="training-scatter-chart"
        onMouseMove={handlePointerMove}
        onMouseLeave={() => setActiveIndex(null)}
      >
        <line x1="18" y1={height - 18} x2={width - 8} y2={height - 18} className="training-axis-line" />
        <line x1="18" y1="8" x2="18" y2={height - 18} className="training-axis-line" />
        {activePoint && (
          <>
            <line x1={scaleX(activePoint.x)} y1="8" x2={scaleX(activePoint.x)} y2={height - 18} className="training-trace-line" />
            <line x1="18" y1={scaleY(activePoint.y)} x2={width - 8} y2={scaleY(activePoint.y)} className="training-zero-line" />
          </>
        )}
        {validPoints.map((point, index) => (
          <circle
            key={`${point.label || "point"}-${index}`}
            cx={scaleX(point.x)}
            cy={scaleY(point.y)}
            r={index === resolvedIndex ? (point.size || 4) + 1.5 : point.size || 4}
            fill={point.color || "var(--accent)"}
            opacity={index === resolvedIndex ? "1" : "0.85"}
          >
            <title>{valueFormatter ? valueFormatter(point) : `${point.x}, ${point.y}`}</title>
          </circle>
        ))}
        <rect x="0" y="0" width={width} height={height} fill="transparent" />
      </svg>
      <div className="training-axis-labels">
        <span>{xLabel}</span>
        <span>{yLabel}</span>
      </div>
    </div>
  );
}

function MetricCard({ label, value, sub, tone = "" }) {
  return (
    <div className={`training-metric-card ${tone}`}>
      <div className="training-metric-label">{label}</div>
      <div className="training-metric-value">{value}</div>
      {sub && <div className="training-metric-sub">{sub}</div>}
    </div>
  );
}

function ChartInterpretation({ text }) {
  if (!text) return null;
  return <div className="training-interpretation">{text}</div>;
}

function MatrixQuadrant({ x, y, label }) {
  const cx = 16 + clamp(x, 0, 100) * 0.68;
  const cy = 84 - clamp(y, 0, 100) * 0.68;
  return (
    <div className="training-matrix">
      <div className="training-matrix-grid">
        <span className="tl">Ready to Push</span>
        <span className="tr">Peak Training</span>
        <span className="bl">Low Strain</span>
        <span className="br">Danger</span>
        <div className="training-matrix-point" style={{ left: `${cx}%`, top: `${cy}%` }} />
      </div>
      <div className="training-matrix-meta">{label}</div>
    </div>
  );
}

const RACE_LABELS = {
  "5K": "5K",
  "10K": "10K",
  HalfMarathon: "Half",
  Marathon: "Marathon",
  Mile: "1 Mile",
};

export default function TrainingTab({ garminData, insights, units, onAskAboutData }) {
  if (!garminData) {
    return (
      <div className="dashboard-empty">
        <svg width="52" height="52" viewBox="0 0 52 52" fill="none" style={{ opacity: 0.3 }}>
          <rect x="10" y="8" width="32" height="36" rx="3" stroke="var(--border)" strokeWidth="1.5" />
          <path d="M18 20h16M18 28h16M18 36h10" stroke="var(--muted)" strokeWidth="2" strokeLinecap="round" />
        </svg>
        <p className="empty-title">No training data</p>
        <p className="empty-sub">Connect Intervals.icu in the Connect tab to see training load, readiness, and recent runs.</p>
      </div>
    );
  }

  const recentRuns = [...(garminData.recent_runs || [])].sort((left, right) => {
    const leftKey = dayKey(left.start_time) || "";
    const rightKey = dayKey(right.start_time) || "";
    return leftKey.localeCompare(rightKey);
  });
  const weeklyTrend = garminData.weekly_trend || [];
  const racePredictions = garminData.race_predictions || [];
  const personalRecords = garminData.personal_records || [];
  const readiness = garminData.readiness_trend || [];
  const sleepRows = garminData.sleep || [];
  const stressRows = garminData.stress || [];
  const bodyBatteryRows = garminData.body_battery || [];
  const restingHr = Number(garminData.resting_hr || 0) || null;
  const restingHrTrend = (garminData.resting_hr_trend || [])
    .map((entry) => ({
      date: dayKey(entry.date),
      restingHr: Number(entry.resting_hr),
    }))
    .filter((entry) => entry.date && Number.isFinite(entry.restingHr));

  const runPaces = recentRuns
    .map((run) => {
      const distance = Number(run.distance || 0);
      const duration = Number(run.duration_in_seconds || 0);
      return distance > 0 && duration > 0 ? duration / (distance / M_PER_MI) : null;
    })
    .filter((value) => Number.isFinite(value));
  const baselinePace = median(runPaces) || 600;
  const baselineHr = median(recentRuns.map((run) => Number(run.average_heartrate || 0)).filter(Boolean)) || 150;

  const derivedRuns = recentRuns.map((run) => {
    const distance = Number(run.distance || 0);
    const duration = Number(run.duration_in_seconds || 0);
    const avgHr = Number(run.average_heartrate || 0) || null;
    const paceSecPerMi = distance > 0 && duration > 0 ? duration / (distance / M_PER_MI) : null;
    const speedMph = distance > 0 && duration > 0 ? (distance / M_PER_MI) / (duration / 3600) : null;
    const intensityFactor = avgHr
      ? clamp(avgHr / Math.max((restingHr || 58) + 95, 135), 0.78, 1.45)
      : paceSecPerMi
        ? clamp(baselinePace / paceSecPerMi, 0.82, 1.3)
        : 1;
    const estimatedLoad = duration > 0 ? (duration / 60) * intensityFactor : 0;
    const efficiency = avgHr && speedMph ? (speedMph / avgHr) * 100 : speedMph;
    return {
      ...run,
      day: dayKey(run.start_time),
      paceSecPerMi,
      speedMph,
      estimatedLoad,
      avgHr,
      efficiency,
    };
  });

  const dayRange = createDayRange(28);
  const readinessByDay = new Map(readiness.map((entry) => [dayKey(entry.date), entry]));
  const sleepByDay = new Map(sleepRows.map((entry) => [dayKey(entry.date), entry]));
  const stressByDay = new Map(stressRows.map((entry) => [dayKey(entry.date), entry]));
  const bodyBatteryByDay = new Map(bodyBatteryRows.map((entry) => [dayKey(entry.date), entry]));
  const runsByDay = new Map();

  derivedRuns.forEach((run) => {
    if (!run.day) return;
    const existing = runsByDay.get(run.day) || [];
    existing.push(run);
    runsByDay.set(run.day, existing);
  });

  const daySeries = dayRange.map((entry, index, array) => {
    const dayRuns = runsByDay.get(entry.key) || [];
    const load = dayRuns.reduce((sum, run) => sum + (run.estimatedLoad || 0), 0);
    const sleep = sleepByDay.get(entry.key);
    const stress = stressByDay.get(entry.key);
    const bodyBattery = bodyBatteryByDay.get(entry.key);
    const readinessEntry = readinessByDay.get(entry.key);
    const sleepHours = sleep ? Number(sleep.duration_s || 0) / 3600 : null;
    const sleepDurationScore = sleepHours != null ? clamp(((sleepHours - 4.5) / 3.5) * 100, 0, 100) : null;
    const sleepScore = sleep?.score != null ? Number(sleep.score) : null;
    const stressInverse = stress?.avg_stress != null ? 100 - Number(stress.avg_stress) : null;
    const bodyBatteryScore = bodyBattery?.end_level != null ? Number(bodyBattery.end_level) : null;
    const readinessScore = readinessEntry?.score != null ? Number(readinessEntry.score) : null;
    const recoveryInputs = [
      { value: readinessScore, weight: 0.38 },
      { value: sleepDurationScore, weight: 0.22 },
      { value: sleepScore, weight: 0.16 },
      { value: bodyBatteryScore, weight: 0.14 },
      { value: stressInverse, weight: 0.10 },
    ].filter((item) => Number.isFinite(item.value));
    const recoveryScore = recoveryInputs.length
      ? recoveryInputs.reduce((sum, item) => sum + item.value * item.weight, 0) / recoveryInputs.reduce((sum, item) => sum + item.weight, 0)
      : null;
    const acuteWindow = array.slice(Math.max(0, index - 6), index + 1);
    const chronicWindow = array.slice(Math.max(0, index - 27), index + 1);
    const acuteLoad = acuteWindow.reduce((sum, item) => sum + (runsByDay.get(item.key) || []).reduce((runSum, run) => runSum + (run.estimatedLoad || 0), 0), 0);
    const chronicLoad = chronicWindow.length
      ? (chronicWindow.reduce((sum, item) => sum + (runsByDay.get(item.key) || []).reduce((runSum, run) => runSum + (run.estimatedLoad || 0), 0), 0) / chronicWindow.length) * 7
      : null;
    const tsb = chronicLoad != null ? chronicLoad - acuteLoad : null;
    const loadRatio = chronicLoad ? acuteLoad / chronicLoad : null;
    const fatigueScore = clamp(
      50
        + (Number.isFinite(loadRatio) ? (loadRatio - 1) * 36 : 0)
        + (recoveryScore != null ? (55 - recoveryScore) * 0.7 : 0)
        + (stress?.avg_stress != null ? (Number(stress.avg_stress) - 40) * 0.18 : 0),
      0,
      100,
    );
    return {
      ...entry,
      load,
      acuteLoad,
      chronicLoad,
      tsb,
      fatigueScore,
      recoveryScore,
      sleepHours,
      sleepScore,
      readinessScore,
      stress: stress?.avg_stress != null ? Number(stress.avg_stress) : null,
      bodyBattery: bodyBatteryScore,
      runCount: dayRuns.length,
    };
  });

  const latestDay = daySeries[daySeries.length - 1];
  const previousDay = daySeries[daySeries.length - 2];
  const currentAcute = garminData.training_load != null ? Number(garminData.training_load) : latestDay?.acuteLoad ?? null;
  const currentChronic = garminData.chronic_load != null ? Number(garminData.chronic_load) : latestDay?.chronicLoad ?? null;
  const currentTsb = currentAcute != null && currentChronic != null ? currentChronic - currentAcute : latestDay?.tsb ?? null;
  const currentRecovery = latestDay?.recoveryScore ?? null;
  const currentFatigue = latestDay?.fatigueScore ?? null;

  const weeklyRamp = weeklyTrend.map((entry, index) => {
    const current = Number(entry.distance_m || 0) / M_PER_MI;
    const previous = index > 0 ? Number(weeklyTrend[index - 1].distance_m || 0) / M_PER_MI : null;
    const ramp = previous && previous > 0 ? ((current - previous) / previous) * 100 : null;
    return { week: entry.week, miles: current, ramp };
  }).slice(-8);

  const loadInsight = currentAcute != null && currentChronic != null
    ? (() => {
        const ratio = currentChronic ? currentAcute / currentChronic : null;
        if (ratio != null && ratio > 1.2 && (currentRecovery ?? 100) < 50) return "High short-term load with weak recovery. Back off intensity.";
        if (ratio != null && ratio >= 0.9 && ratio <= 1.1 && (currentRecovery ?? 0) >= 60) return "Load and recovery are aligned for productive progression.";
        if (ratio != null && ratio < 0.85 && (currentRecovery ?? 0) > 70) return "Recovery is ahead of current strain. There is room to push.";
        return "Training load is mixed. Watch recovery before adding more intensity.";
      })()
    : "Training load trend needs more run data.";

  const recoveryInsight = currentRecovery != null && previousDay?.recoveryScore != null
    ? currentRecovery < 45 && (currentAcute ?? 0) > (currentChronic ?? currentAcute ?? 0)
      ? "Low readiness on top of elevated load is a red flag for overreaching."
      : currentRecovery > 65 && (currentAcute ?? 0) <= (currentChronic ?? currentAcute ?? 0) * 1.05
        ? "Recovery is supportive of quality work if you feel good."
        : "Recovery is moderate. Keep progression controlled."
    : "Readiness trend will sharpen as sleep and run data accumulate.";

  const scatterPoints = daySeries
    .filter((entry) => entry.recoveryScore != null && entry.load > 0)
    .map((entry) => ({
      x: entry.load,
      y: entry.recoveryScore,
      color: entry.sleepScore != null && entry.sleepScore >= 75 ? "var(--green)" : entry.sleepScore != null && entry.sleepScore < 60 ? "var(--warn)" : "var(--accent)",
      label: entry.key,
      size: 4 + Math.min(4, entry.runCount),
    }));

  const sleepPerformancePairs = sleepRows
    .map((sleep) => {
      const sleepDate = parseDay(sleep.date);
      if (!sleepDate) return null;
      const nextDayDate = new Date(sleepDate.getTime() + DAY_MS);
      const nextDay = formatLocalIso(nextDayDate);
      const nextRuns = (runsByDay.get(nextDay) || []).filter((run) => Number.isFinite(run.efficiency));
      if (!nextRuns.length) return null;
      const nextRun = nextRuns[0];
      return {
        sleepHours: Number(sleep.duration_s || 0) / 3600,
        performance: nextRun.efficiency,
        pace: nextRun.paceSecPerMi,
        label: nextDay,
      };
    })
    .filter(Boolean);

  const sleepCorrelation = pearsonCorrelation(
    sleepPerformancePairs.map((item) => item.sleepHours),
    sleepPerformancePairs.map((item) => item.performance),
  );

  const efficiencyRuns = derivedRuns.filter((run) => Number.isFinite(run.efficiency)).slice(-10);
  const recentEfficiency = average(efficiencyRuns.slice(-3).map((run) => run.efficiency));
  const baselineEfficiency = average(efficiencyRuns.slice(0, Math.max(1, efficiencyRuns.length - 3)).map((run) => run.efficiency)) ?? recentEfficiency;
  const efficiencyDelta = recentEfficiency != null && baselineEfficiency != null ? ((recentEfficiency - baselineEfficiency) / baselineEfficiency) * 100 : null;
  const longRuns = derivedRuns.filter((run) => (Number(run.distance || 0) / M_PER_MI) >= 8 || Number(run.duration_in_seconds || 0) >= 75 * 60);
  const fatigueRuns = longRuns
    .filter((run) => Number.isFinite(run.efficiency) && Number.isFinite(run.paceSecPerMi))
    .map((run) => ({
      ...run,
      distanceMi: Number(run.distance || 0) / M_PER_MI,
      durationMin: Number(run.duration_in_seconds || 0) / 60,
    }))
    .slice(-8);
  const fatigueResistanceBaseline = median(fatigueRuns.map((run) => run.efficiency)) ?? baselineEfficiency;
  const fatigueResistanceRuns = fatigueRuns
    .filter((run) => Number.isFinite(fatigueResistanceBaseline) && fatigueResistanceBaseline > 0)
    .map((run) => {
      const fatigueResistance = (run.efficiency / fatigueResistanceBaseline) * 100;
      const overSixtyMinutes = Math.max(0, run.durationMin - 60);
      const fatigueSlope = overSixtyMinutes > 0 ? (100 - fatigueResistance) / (overSixtyMinutes / 30) : 0;
      return {
        ...run,
        fatigueResistance,
        fatigueSlope,
      };
    });
  const latestFatigueResistance = fatigueResistanceRuns.length ? fatigueResistanceRuns[fatigueResistanceRuns.length - 1].fatigueResistance : null;
  const latestFatigueSlope = fatigueResistanceRuns.length ? fatigueResistanceRuns[fatigueResistanceRuns.length - 1].fatigueSlope : null;
  const fatigueSlopeMedian = median(fatigueResistanceRuns.map((run) => run.fatigueSlope));
  const fatigueCurvePoints = fatigueResistanceRuns.map((run) => ({
    x: run.durationMin,
    y: run.fatigueResistance,
    color: run.fatigueResistance >= 97 ? "var(--green)" : run.fatigueResistance >= 94 ? "var(--accent)" : "var(--warn)",
    label: run.day,
  }));
  const fatigueSlopeBuckets = [
    { label: "0-1", min: 0, max: 1 },
    { label: "1-2", min: 1, max: 2 },
    { label: "2-3", min: 2, max: 3 },
    { label: "3-4", min: 3, max: 4 },
    { label: "4+", min: 4, max: Number.POSITIVE_INFINITY },
  ].map((bucket) => ({
    ...bucket,
    count: fatigueResistanceRuns.filter((run) => run.fatigueSlope >= bucket.min && run.fatigueSlope < bucket.max).length,
  }));
  const fatigueResistanceInsight = latestFatigueResistance == null
    ? "Need more long runs with heart-rate data to estimate fatigue resistance."
    : latestFatigueResistance < 94
      ? "Late-run fade looks meaningful. Marathon durability is a limiter right now."
      : latestFatigueResistance < 97
        ? "Fatigue resistance is moderate. Long-run durability is improving but not fully locked in."
        : "Fatigue resistance is strong. Pace is holding well as duration rises.";

  const qualityBuckets = derivedRuns.reduce((accumulator, run) => {
    const hrRatio = run.avgHr ? run.avgHr / baselineHr : null;
    const paceRatio = run.paceSecPerMi ? baselinePace / run.paceSecPerMi : null;
    let bucket = "steady";
    if ((hrRatio != null && hrRatio < 0.92) || (paceRatio != null && paceRatio < 0.95)) bucket = "easy";
    if ((hrRatio != null && hrRatio > 1.03) || (paceRatio != null && paceRatio > 1.06)) bucket = "hard";
    accumulator[bucket] += run.duration_in_seconds || 0;
    return accumulator;
  }, { easy: 0, steady: 0, hard: 0 });
  const totalQualitySeconds = qualityBuckets.easy + qualityBuckets.steady + qualityBuckets.hard;

  const matrixStrain = currentAcute != null && currentChronic
    ? clamp((currentAcute / currentChronic) * 50, 0, 100)
    : clamp((latestDay?.acuteLoad || 0) * 1.6, 0, 100);
  const matrixRecovery = currentRecovery != null ? currentRecovery : 50;
  const matrixLabel = matrixStrain > 60 && matrixRecovery < 45
    ? "High strain + low recovery"
    : matrixStrain > 60 && matrixRecovery >= 45
      ? "High strain + strong recovery"
      : matrixStrain <= 60 && matrixRecovery >= 55
        ? "Low strain + high recovery"
        : "Balanced but watch fatigue";

  const readinessValues = readiness.map((entry) => entry.score || 0).filter(Boolean);
  const restingHrWindow = restingHrTrend.slice(-14);
  const restingHrValues = restingHrWindow.map((entry) => entry.restingHr);
  const restingHrAverage = rollingAverage(restingHrValues, 7);
  const latestRestingHr = restingHrWindow.length ? restingHrWindow[restingHrWindow.length - 1].restingHr : restingHr;
  const restingHrBaseline = average(restingHrWindow.slice(0, Math.max(0, restingHrWindow.length - 3)).map((entry) => entry.restingHr));
  const restingHrDelta = latestRestingHr != null && restingHrBaseline != null ? latestRestingHr - restingHrBaseline : null;
  const restingHrInsight = latestRestingHr == null
    ? "Daily resting HR history is not available yet."
    : restingHrDelta != null && restingHrDelta >= 4
      ? "Resting HR is running above baseline. Treat that as a fatigue or illness warning flag."
      : restingHrDelta != null && restingHrDelta <= -3
        ? "Resting HR is below baseline. That usually aligns with good recovery."
        : "Resting HR is near baseline. Recovery signal looks stable.";

  return (
    <div className="dashboard">
      {insights?.recovery_alerts && (
        <RecoveryAlertsPanel alerts={insights.recovery_alerts} units={units} onAskAboutData={onAskAboutData} />
      )}

      <div className="dashboard-section">
        <div className="section-header">
          <h3 className="section-title">Training Load & Fitness Trends</h3>
          <button className="ask-btn" onClick={() => onAskAboutData("Assess whether my current training load and recovery trend look productive or risky.")}>
            Ask AI ↗
          </button>
        </div>
        <div className="training-metric-grid">
          <MetricCard label="Acute Load" value={formatValue(currentAcute, 0)} sub={garminData.training_load != null ? "provider load" : "estimated from recent runs"} tone="accent" />
          <MetricCard label="Chronic Load" value={formatValue(currentChronic, 0)} sub={garminData.chronic_load != null ? "provider load" : "28-day rolling"} />
          <MetricCard label="TSB" value={formatSignedNumber(currentTsb, 0)} sub="chronic minus acute" tone={currentTsb != null && currentTsb < -15 ? "warn" : currentTsb != null && currentTsb > 5 ? "good" : ""} />
          <MetricCard label="Ramp Rate" value={formatSignedPercent(weeklyRamp[weeklyRamp.length - 1]?.ramp)} sub="week-over-week mileage" tone={weeklyRamp[weeklyRamp.length - 1]?.ramp > 12 ? "warn" : "good"} />
        </div>
        <div className="training-two-col">
          <div className="chart-card">
            <div className="training-section-head">
              <div className="training-section-title">Acute vs Chronic</div>
              <div className="training-section-note">Estimated from the last 28 days of runs</div>
            </div>
            <ChartInterpretation text="Read this as short-term load versus your longer baseline. When Acute stays a bit above Chronic, training is building; when it spikes far above, injury and burnout risk rise." />
            <MultiLineChart
              labels={daySeries.map((entry) => entry.label)}
              series={[
                { label: "Acute", data: daySeries.map((entry) => entry.acuteLoad), color: "var(--accent)" },
                { label: "Chronic", data: daySeries.map((entry) => entry.chronicLoad), color: "var(--green)" },
              ]}
              valueFormatter={(value) => formatValue(value, 0)}
            />
            <div className="chart-note">{loadInsight}</div>
          </div>
          <div className="chart-card">
            <div className="training-section-head">
              <div className="training-section-title">TSB Zone</div>
              <div className="training-section-note">Target zone is roughly -10 to -30</div>
            </div>
            <ChartInterpretation text="TSB is form freshness. Very negative values mean you are carrying fatigue, mildly negative often supports productive training, and positive values usually mean you are fresher but less loaded." />
            <MultiLineChart
              labels={daySeries.map((entry) => entry.label)}
              series={[{ label: "TSB", data: daySeries.map((entry) => entry.tsb), color: "var(--warn)" }]}
              valueFormatter={(value) => formatSignedNumber(value, 0)}
            />
            <div className="chart-note">Current TSB: {formatSignedNumber(currentTsb, 0)}</div>
          </div>
        </div>
        <div className="chart-card">
          <div className="training-section-head">
            <div className="training-section-title">Weekly Ramp Rate</div>
            <div className="training-section-note">Mileage-based change from the previous week</div>
          </div>
          <ChartInterpretation text="This shows how fast mileage is changing week to week. Small steady increases are easier to absorb; repeated large jumps suggest your training load is rising faster than your recovery." />
          <div className="training-ramp-bars">
            {weeklyRamp.map((entry, index) => {
              const maxMiles = Math.max(...weeklyRamp.map((row) => row.miles || 0), 1);
              const height = Math.max(8, ((entry.miles || 0) / maxMiles) * 100);
              const isHigh = entry.ramp != null && entry.ramp > 12;
              return (
                <div key={`${entry.week}-${index}`} className="training-ramp-col">
                  <div className="training-ramp-wrap">
                    <div className={`training-ramp-bar ${isHigh ? "warn" : ""}`} style={{ height: `${height}%` }} />
                  </div>
                  <div className="chart-val">{entry.ramp != null ? `${entry.ramp.toFixed(0)}%` : "—"}</div>
                  <div className="chart-lbl">{dayLabel(entry.week)}</div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      <div className="dashboard-section">
        <div className="section-header">
          <h3 className="section-title">Recovery & Readiness</h3>
          <button className="ask-btn" onClick={() => onAskAboutData("Summarize my readiness, fatigue, and whether I should push or recover this week.")}>
            Ask AI ↗
          </button>
        </div>
        <div className="training-metric-grid">
          <MetricCard label="Recovery Score" value={formatValue(currentRecovery, 0)} sub="0 to 100 composite" tone={currentRecovery != null && currentRecovery < 45 ? "warn" : "good"} />
          <MetricCard label="Fatigue Index" value={formatValue(currentFatigue, 0)} sub="higher means more strain" tone={currentFatigue != null && currentFatigue > 65 ? "warn" : ""} />
          <MetricCard label="Resting HR" value={restingHr != null ? `${restingHr.toFixed(0)} bpm` : "—"} sub="latest available" />
          <MetricCard label="HRV" value={garminData.hrv != null ? garminData.hrv : "—"} sub={garminData.hrv_status || "latest available"} />
        </div>
        <div className="training-two-col">
          <div className="chart-card">
            <div className="training-section-head">
              <div className="training-section-title">Daily Readiness Score</div>
              <div className="training-section-note">Composite of readiness, sleep, stress, and body battery</div>
            </div>
            <ChartInterpretation text="Compare the two lines together. Recovery trending above Fatigue supports harder sessions, while falling Recovery with rising Fatigue usually means back off or keep intensity controlled." />
            <MultiLineChart
              labels={daySeries.slice(-14).map((entry) => entry.label)}
              series={[
                { label: "Recovery", data: daySeries.slice(-14).map((entry) => entry.recoveryScore), color: "var(--accent)" },
                { label: "Fatigue", data: daySeries.slice(-14).map((entry) => entry.fatigueScore), color: "var(--warn)" },
              ]}
              valueFormatter={(value) => formatValue(value, 0)}
            />
            <div className="chart-note">{recoveryInsight}</div>
          </div>
          <div className="chart-card">
            <div className="training-section-head">
              <div className="training-section-title">Strain vs Recovery Matrix</div>
              <div className="training-section-note">Recovery on Y-axis, strain on X-axis</div>
            </div>
            <ChartInterpretation text="Top-left is the best place to absorb quality training: good recovery with manageable strain. Bottom-right is the danger zone: high strain paired with low recovery." />
            <MatrixQuadrant x={matrixStrain} y={matrixRecovery} label={matrixLabel} />
          </div>
        </div>
        {restingHrWindow.length > 0 && (
          <div className="chart-card">
            <div className="training-section-head">
              <div className="training-section-title">Resting Heart Rate Trend</div>
              <div className="training-section-note">Last 14 days with 7-day average</div>
            </div>
            <ChartInterpretation text="Resting HR is a simple recovery check. A rising line usually means accumulated fatigue, life stress, heat, or illness; a flat or falling line usually means you are absorbing training well." />
            <MultiLineChart
              labels={restingHrWindow.map((entry) => dayLabel(entry.date))}
              series={[
                { label: "RHR", data: restingHrValues, color: "var(--warn)" },
                { label: "7-day avg", data: restingHrAverage, color: "var(--accent)" },
              ]}
              valueFormatter={(value) => `${formatValue(value, 0)} bpm`}
            />
            <div className="chart-note">
              Latest: {latestRestingHr != null ? `${latestRestingHr.toFixed(0)} bpm` : "—"} {restingHrDelta != null ? `(${restingHrDelta >= 0 ? "+" : ""}${restingHrDelta.toFixed(1)} vs baseline)` : ""}
            </div>
            <div className="chart-note">{restingHrInsight}</div>
          </div>
        )}
      </div>

      <div className="dashboard-section">
        <h3 className="section-title">Recovery Curve</h3>
        <div className="training-two-col">
          <div className="chart-card">
            <div className="training-section-head">
              <div className="training-section-title">Recovery vs Load Scatter</div>
              <div className="training-section-note">Uses readiness composite because daily HRV history is not available</div>
            </div>
            <ChartInterpretation text="Each dot is one day. Dots higher and farther left mean you stayed recovered with lower load; dots drifting lower as load rises suggest your recovery is not keeping up with harder days." />
            <ScatterChart
              points={scatterPoints}
              xLabel="Daily load"
              yLabel="Recovery score"
              valueFormatter={(point) => `${point.label}: load ${point.x.toFixed(0)}, recovery ${point.y.toFixed(0)}`}
            />
          </div>
          <div className="chart-card">
            <div className="training-section-head">
              <div className="training-section-title">Sleep vs Next-Day Performance</div>
              <div className="training-section-note">Next-day efficiency from pace and HR when available</div>
            </div>
            <ChartInterpretation text="Look for whether better performance clusters at higher sleep hours. A clear upward pattern suggests sleep is helping next-day running quality; a flat cloud means the signal is weak or mixed." />
            <ScatterChart
              points={sleepPerformancePairs.map((item) => ({
                x: item.sleepHours,
                y: item.performance,
                color: "var(--green)",
                label: item.label,
              }))}
              xLabel="Sleep hours"
              yLabel="Next-day efficiency"
              valueFormatter={(point) => `${point.label}: ${point.x.toFixed(1)} h sleep`}
            />
            <div className="chart-note">
              Correlation: {sleepCorrelation != null ? sleepCorrelation.toFixed(2) : "—"} {sleepCorrelation != null && sleepCorrelation > 0.25 ? "Sleep is helping performance." : sleepCorrelation != null && sleepCorrelation < -0.25 ? "Sleep may be limiting performance." : "More paired data needed."}
            </div>
          </div>
        </div>
      </div>

      <div className="dashboard-section">
        <h3 className="section-title">Efficiency & Workout Distribution</h3>
        <div className="training-two-col">
          <div className="chart-card">
            <div className="training-section-head">
              <div className="training-section-title">Aerobic Efficiency Trend</div>
              <div className="training-section-note">Speed divided by HR when heart rate is present</div>
            </div>
            <ChartInterpretation text="Higher is better here. If efficiency rises over similar runs, you are holding more speed for the same effort; a steady slide down can signal fatigue, heat, or lost aerobic sharpness." />
            <MultiLineChart
              labels={efficiencyRuns.map((run) => dayLabel(run.day))}
              series={[{ label: "Efficiency", data: efficiencyRuns.map((run) => run.efficiency), color: "var(--accent)" }]}
              valueFormatter={(value) => formatValue(value, 3)}
            />
            <div className="chart-note">
              {efficiencyDelta != null
                ? `${efficiencyDelta >= 0 ? "+" : ""}${efficiencyDelta.toFixed(1)}% versus baseline.`
                : "Need more runs with heart-rate data to judge efficiency."}
            </div>
          </div>
          <div className="chart-card">
            <div className="training-section-head">
              <div className="training-section-title">Workout Quality Split</div>
              <div className="training-section-note">Estimated from pace and heart-rate relative to baseline</div>
            </div>
            <ChartInterpretation text="This is your intensity mix. Most runners want easy work to dominate, with smaller steady and hard portions; if the hard segment grows too much, recovery usually becomes the limiter." />
            <div className="training-quality-stack">
              <div className="easy" style={{ width: totalQualitySeconds ? `${(qualityBuckets.easy / totalQualitySeconds) * 100}%` : "0%" }} />
              <div className="steady" style={{ width: totalQualitySeconds ? `${(qualityBuckets.steady / totalQualitySeconds) * 100}%` : "0%" }} />
              <div className="hard" style={{ width: totalQualitySeconds ? `${(qualityBuckets.hard / totalQualitySeconds) * 100}%` : "0%" }} />
            </div>
            <div className="training-quality-legend">
              <span><i className="easy" />Easy {totalQualitySeconds ? `${((qualityBuckets.easy / totalQualitySeconds) * 100).toFixed(0)}%` : "—"}</span>
              <span><i className="steady" />Steady {totalQualitySeconds ? `${((qualityBuckets.steady / totalQualitySeconds) * 100).toFixed(0)}%` : "—"}</span>
              <span><i className="hard" />Hard {totalQualitySeconds ? `${((qualityBuckets.hard / totalQualitySeconds) * 100).toFixed(0)}%` : "—"}</span>
            </div>
            <div className="chart-note">This is a proxy for intensity balance, not true zone-time data.</div>
          </div>
        </div>
      </div>

      <div className="dashboard-section">
        <h3 className="section-title">Fatigue Resistance Curve</h3>
        <div className="training-two-col">
          <div className="chart-card">
            <div className="training-section-head">
              <div className="training-section-title">Duration vs Resistance</div>
              <div className="training-section-note">Proxy from average-run efficiency because split-level first/last 20% data is not available</div>
            </div>
            <ChartInterpretation text="This estimates how well you maintain efficiency as runs get longer. Points that stay higher at longer durations suggest stronger durability; lower points on long runs suggest meaningful late-run fade." />
            <ScatterChart
              points={fatigueCurvePoints}
              xLabel="Run duration (min)"
              yLabel="Fatigue resistance"
              valueFormatter={(point) => `${point.label}: ${point.x.toFixed(0)} min, ${point.y.toFixed(1)}%`}
            />
            <div className="chart-note">
              {fatigueResistanceInsight} Latest: {latestFatigueResistance != null ? `${latestFatigueResistance.toFixed(1)}%` : "—"}.
            </div>
          </div>
          <div className="chart-card">
            <div className="training-section-head">
              <div className="training-section-title">Fatigue Slope Histogram</div>
              <div className="training-section-note">Estimated fade per extra 30 min after the first hour</div>
            </div>
            <ChartInterpretation text="Lower buckets are better because they mean less fade as the run goes on. If more of your runs pile up in the higher buckets, endurance is breaking down late in longer efforts." />
            <div className="training-ramp-bars">
              {fatigueSlopeBuckets.map((bucket) => {
                const maxCount = Math.max(...fatigueSlopeBuckets.map((entry) => entry.count), 1);
                const height = Math.max(8, (bucket.count / maxCount) * 100);
                return (
                  <div key={bucket.label} className="training-ramp-col">
                    <div className="training-ramp-wrap">
                      <div className={`training-ramp-bar ${bucket.min >= 3 ? "warn" : ""}`} style={{ height: `${height}%` }} />
                    </div>
                    <div className="chart-val">{bucket.count}</div>
                    <div className="chart-lbl">{bucket.label}</div>
                  </div>
                );
              })}
            </div>
            <div className="chart-note">
              Median slope: {fatigueSlopeMedian != null ? `${fatigueSlopeMedian.toFixed(1)}% / 30 min` : "—"}. Latest: {latestFatigueSlope != null ? `${latestFatigueSlope.toFixed(1)}% / 30 min` : "—"}.
            </div>
          </div>
        </div>
      </div>

      {readinessValues.length > 1 && (
        <div className="dashboard-section">
          <h3 className="section-title">Native Readiness / Form — 14 Days</h3>
          <div className="chart-card">
            <ChartInterpretation text="This is Garmin's own readiness trend over the last two weeks. Taller green bars suggest you are set up to train well; repeated orange or red bars point to accumulated fatigue or incomplete recovery." />
            <div className="chart-header-row">
              {readiness.slice(-14).map((entry, index) => {
                const value = entry.score || 0;
                const color = value >= 67 ? "var(--green)" : value >= 34 ? "var(--accent)" : "var(--warn)";
                return (
                  <div key={`${entry.date || "readiness"}-${index}`} className="chart-col">
                    <div className="chart-bar-wrap">
                      <div className="chart-bar-fill" style={{ height: `${Math.abs(value)}%`, background: color }} />
                    </div>
                    <div className="chart-val">{value || "—"}</div>
                    <div className="chart-lbl">{entry.date?.slice(5)}</div>
                  </div>
                );
              })}
            </div>
            {readiness.slice(-1)[0]?.feedback && <div className="chart-note">{readiness.slice(-1)[0].feedback}</div>}
          </div>
        </div>
      )}

      {racePredictions.length > 0 && (
        <div className="dashboard-section">
          <div className="section-header">
            <h3 className="section-title">Race Predictions</h3>
            <button className="ask-btn" onClick={() => onAskAboutData("Based on my race predictions and training, what shoe should I race in?")}>
              Ask AI ↗
            </button>
          </div>
          <div className="race-pred-grid">
            {racePredictions.map((prediction, index) => {
              const distance = prediction.distance || "";
              const label = RACE_LABELS[distance] || distance;
              const timeValue = prediction.time_seconds || prediction.time || prediction.predictedTime;
              return (
                <div key={`${distance}-${index}`} className="race-pred-card">
                  <div className="race-dist">{label}</div>
                  <div className="race-time">{formatRaceTime(timeValue)}</div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {personalRecords.length > 0 && (
        <div className="dashboard-section">
          <div className="section-header">
            <h3 className="section-title">Personal Records</h3>
            <button className="ask-btn" onClick={() => onAskAboutData("Given my personal records, what racing shoe would help me PR?")}>
              Ask AI ↗
            </button>
          </div>
          <div className="pr-grid">
            {personalRecords.slice(0, 8).map((record, index) => {
              const label = RACE_LABELS[record.distance] || record.distance || "?";
              return (
                <div key={`${label}-${index}`} className="pr-card">
                  <div className="pr-dist">{label}</div>
                  <div className="pr-time">{formatRaceTime(record.time_seconds)}</div>
                  {record.date && <div className="pr-date">{new Date(record.date).toLocaleDateString("en-US", { month: "short", year: "numeric" })}</div>}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
