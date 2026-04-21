from __future__ import annotations

from datetime import date, datetime
from statistics import mean
from typing import Any


M_PER_MI = 1609.34


def _as_float(value: Any) -> float | None:
    try:
        if value in (None, "", [], {}):
            return None
        return float(value)
    except Exception:
        return None


def _parse_iso_date(value: Any) -> date | None:
    if not value:
        return None
    try:
        return datetime.fromisoformat(str(value)[:10]).date()
    except Exception:
        return None


def _normalize_distance_label(label: str | None) -> str | None:
    if not label:
        return None
    raw = str(label).strip().lower().replace(" ", "")
    aliases = {
        "5k": "5k",
        "10k": "10k",
        "half": "halfmarathon",
        "halfmarathon": "halfmarathon",
        "marathon": "marathon",
        "mile": "mile",
        "1mile": "mile",
    }
    return aliases.get(raw, raw)


def _format_seconds_hms(total_seconds: int | float | None) -> str | None:
    if total_seconds is None:
        return None
    secs = int(total_seconds)
    if secs <= 0:
        return None
    h = secs // 3600
    m = (secs % 3600) // 60
    s = secs % 60
    if h:
        return f"{h}:{m:02d}:{s:02d}"
    return f"{m}:{s:02d}"


def _pace_seconds_per_mile(distance_m: float | None, duration_s: float | None) -> float | None:
    if not distance_m or not duration_s or distance_m <= 0 or duration_s <= 0:
        return None
    return float(duration_s) / (float(distance_m) / M_PER_MI)


def _compute_weekly_trend(weekly_trend: list[dict[str, Any]]) -> dict[str, Any]:
    rows = []
    for item in weekly_trend or []:
        week = str(item.get("week") or "")
        dist_m = _as_float(item.get("distance_m")) or 0.0
        if week:
            rows.append({"week": week, "distance_m": dist_m, "distance_mi": dist_m / M_PER_MI})
    rows = rows[-12:]

    current = rows[-1]["distance_m"] if rows else 0.0
    prev = rows[-2]["distance_m"] if len(rows) > 1 else 0.0
    delta_m = current - prev
    pct = (delta_m / prev * 100.0) if prev > 0 else None
    trend = "flat"
    if delta_m > 1609.34:
        trend = "up"
    elif delta_m < -1609.34:
        trend = "down"

    if not rows:
        interpretation = "Weekly mileage trend unavailable."
    elif trend == "up":
        interpretation = "Mileage is building versus last week."
    elif trend == "down":
        interpretation = "Mileage is down versus last week."
    else:
        interpretation = "Mileage is stable week over week."

    return {
        "weeks": rows,
        "current_week_m": current,
        "current_week_mi": current / M_PER_MI,
        "previous_week_m": prev,
        "delta_m": delta_m,
        "delta_pct": pct,
        "trend_direction": trend,
        "interpretation": interpretation,
    }


def _compute_consistency(weekly_rows: list[dict[str, Any]]) -> dict[str, Any]:
    if not weekly_rows:
        return {
            "active_weeks": 0,
            "weeks_tracked": 0,
            "consistency_ratio": 0.0,
            "longest_streak_weeks": 0,
            "current_streak_weeks": 0,
            "rolling_4wk_avg_m": 0.0,
            "rolling_4wk_avg_mi": 0.0,
        }

    active_threshold = 1609.34  # at least 1 mile
    active_flags = [row.get("distance_m", 0.0) >= active_threshold for row in weekly_rows]
    active_weeks = sum(1 for flag in active_flags if flag)

    longest = 0
    current = 0
    for flag in active_flags:
        if flag:
            current += 1
            longest = max(longest, current)
        else:
            current = 0
    trailing = 0
    for flag in reversed(active_flags):
        if flag:
            trailing += 1
        else:
            break

    trailing_rows = weekly_rows[-4:]
    rolling_4wk_avg_m = mean([row.get("distance_m", 0.0) for row in trailing_rows]) if trailing_rows else 0.0
    weeks = len(weekly_rows)

    return {
        "active_weeks": active_weeks,
        "weeks_tracked": weeks,
        "consistency_ratio": (active_weeks / weeks) if weeks else 0.0,
        "longest_streak_weeks": longest,
        "current_streak_weeks": trailing,
        "rolling_4wk_avg_m": rolling_4wk_avg_m,
        "rolling_4wk_avg_mi": rolling_4wk_avg_m / M_PER_MI,
    }


def _compute_pace_efficiency(recent_runs: list[dict[str, Any]]) -> dict[str, Any]:
    clean_runs = []
    for run in recent_runs or []:
        dist = _as_float(run.get("distance"))
        dur = _as_float(run.get("duration_in_seconds"))
        hr = _as_float(run.get("average_heartrate"))
        pace = _pace_seconds_per_mile(dist, dur)
        if pace is None:
            continue
        clean_runs.append(
            {
                "date": str(run.get("start_time") or "")[:10],
                "distance_m": dist,
                "duration_s": dur,
                "avg_hr": hr,
                "pace_sec_per_mi": pace,
            }
        )

    if not clean_runs:
        return {
            "run_count": 0,
            "recent_avg_pace_sec_per_mi": None,
            "baseline_avg_pace_sec_per_mi": None,
            "pace_delta_sec_per_mi": None,
            "efficiency_score": None,
            "interpretation": "Not enough run data for pace trend.",
        }

    ordered = sorted(clean_runs, key=lambda r: r.get("date") or "")
    tail = ordered[-3:]
    head = ordered[:-3] if len(ordered) > 3 else ordered[:]
    recent_avg = mean([r["pace_sec_per_mi"] for r in tail]) if tail else None
    baseline_avg = mean([r["pace_sec_per_mi"] for r in head]) if head else recent_avg
    delta = (recent_avg - baseline_avg) if (recent_avg is not None and baseline_avg is not None) else None

    hr_runs = [r for r in ordered if r.get("avg_hr")]
    efficiency = None
    if len(hr_runs) >= 2:
        scores = []
        for r in hr_runs:
            pace = r.get("pace_sec_per_mi")
            hr = r.get("avg_hr")
            if pace and hr:
                scores.append((M_PER_MI / pace) / hr)
        if scores:
            efficiency = mean(scores)

    if delta is None:
        interpretation = "Pace trend unavailable."
    elif delta < -8:
        interpretation = "Recent pace improved versus baseline."
    elif delta > 8:
        interpretation = "Recent pace slowed versus baseline."
    else:
        interpretation = "Recent pace is steady versus baseline."

    return {
        "run_count": len(ordered),
        "recent_avg_pace_sec_per_mi": recent_avg,
        "baseline_avg_pace_sec_per_mi": baseline_avg,
        "pace_delta_sec_per_mi": delta,
        "efficiency_score": efficiency,
        "interpretation": interpretation,
    }


def _compute_race_prediction_summary(
    race_predictions: list[dict[str, Any]], personal_records: list[dict[str, Any]]
) -> dict[str, Any]:
    preds: dict[str, int] = {}
    for item in race_predictions or []:
        key = _normalize_distance_label(item.get("distance"))
        secs = _as_float(item.get("time_seconds"))
        if key and secs:
            preds[key] = int(secs)

    prs: dict[str, int] = {}
    for item in personal_records or []:
        key = _normalize_distance_label(item.get("distance"))
        secs = _as_float(item.get("time_seconds"))
        if key and secs:
            prs[key] = int(secs)

    comparisons = []
    for key, pred_secs in preds.items():
        pr_secs = prs.get(key)
        delta = None
        if pr_secs:
            delta = pr_secs - pred_secs
        comparisons.append(
            {
                "distance": key,
                "predicted_seconds": pred_secs,
                "predicted_time": _format_seconds_hms(pred_secs),
                "pr_seconds": pr_secs,
                "pr_time": _format_seconds_hms(pr_secs) if pr_secs else None,
                "potential_pr_delta_seconds": delta,
                "potential_pr_delta_time": _format_seconds_hms(abs(delta)) if delta else None,
                "is_pr_window": bool(delta and delta > 0),
            }
        )

    pr_windows = [c for c in comparisons if c.get("is_pr_window")]
    best = max(pr_windows, key=lambda c: c["potential_pr_delta_seconds"]) if pr_windows else None

    summary = "Race predictions unavailable."
    if comparisons:
        if best:
            label = (best["distance"] or "").upper()
            summary = f"Best projected PR window is {label}."
        else:
            summary = "Predictions are close to existing PR marks."

    return {
        "predictions": comparisons,
        "best_pr_window": best,
        "summary": summary,
    }


def _compute_pr_progress(personal_records: list[dict[str, Any]]) -> dict[str, Any]:
    grouped: dict[str, list[dict[str, Any]]] = {}
    for pr in personal_records or []:
        key = _normalize_distance_label(pr.get("distance"))
        secs = _as_float(pr.get("time_seconds"))
        pr_date = _parse_iso_date(pr.get("date"))
        if not key or not secs:
            continue
        grouped.setdefault(key, []).append({"seconds": int(secs), "date": pr_date})

    progression = []
    for key, samples in grouped.items():
        samples = sorted(samples, key=lambda x: x.get("date") or date.min)
        best = min(samples, key=lambda x: x["seconds"])
        latest = samples[-1]
        first = samples[0]
        trend_delta = first["seconds"] - latest["seconds"] if len(samples) > 1 else 0
        progression.append(
            {
                "distance": key,
                "best_seconds": best["seconds"],
                "best_time": _format_seconds_hms(best["seconds"]),
                "best_date": best["date"].isoformat() if best.get("date") else None,
                "latest_seconds": latest["seconds"],
                "latest_time": _format_seconds_hms(latest["seconds"]),
                "latest_date": latest["date"].isoformat() if latest.get("date") else None,
                "career_delta_seconds": trend_delta,
            }
        )

    progression.sort(key=lambda x: x["distance"])
    return {
        "progression": progression,
        "has_progression": bool(progression),
    }


def _build_bullets(
    week_trend: dict[str, Any],
    consistency: dict[str, Any],
    pace_eff: dict[str, Any],
    race: dict[str, Any],
    training_data: dict[str, Any] | None,
) -> list[str]:
    bullets: list[str] = []

    bullets.append(week_trend.get("interpretation") or "Mileage trend unavailable.")

    streak = consistency.get("current_streak_weeks", 0)
    ratio = consistency.get("consistency_ratio", 0.0)
    bullets.append(
        f"Consistency is {ratio * 100:.0f}% across tracked weeks with a {streak}-week active streak."
    )

    pace_msg = pace_eff.get("interpretation")
    if pace_msg:
        bullets.append(pace_msg)

    race_msg = race.get("summary")
    if race_msg:
        bullets.append(race_msg)

    readiness = (training_data or {}).get("readiness_trend") or []
    if readiness:
        last = readiness[-1]
        score = _as_float(last.get("score"))
        if score is not None:
            if score < 35:
                bullets.append("Recent readiness is low, so keep quality sessions controlled.")
            elif score > 66:
                bullets.append("Recent readiness is supportive of harder sessions.")
            else:
                bullets.append("Recent readiness is moderate; maintain steady progression.")

    return bullets[:6]


def compute_long_term_analytics(
    garmin_data: dict | None, training_data: dict | None = None
) -> dict:
    garmin = garmin_data or {}
    week_trend = _compute_weekly_trend(garmin.get("weekly_trend") or [])
    consistency = _compute_consistency(week_trend.get("weeks") or [])
    pace_efficiency = _compute_pace_efficiency(garmin.get("recent_runs") or [])
    race_summary = _compute_race_prediction_summary(
        garmin.get("race_predictions") or [],
        garmin.get("personal_records") or [],
    )
    pr_progress = _compute_pr_progress(garmin.get("personal_records") or [])

    bullets = _build_bullets(
        week_trend=week_trend,
        consistency=consistency,
        pace_eff=pace_efficiency,
        race=race_summary,
        training_data=training_data,
    )

    return {
        "status": "ok",
        "week_trend": week_trend,
        "consistency": consistency,
        "pace_efficiency": pace_efficiency,
        "race_predictions": race_summary,
        "pr_progress": pr_progress,
        "bullets": bullets,
    }
