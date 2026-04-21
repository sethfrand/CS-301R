from __future__ import annotations

from datetime import date, datetime
from typing import Any


def _num(value: Any) -> float | None:
    if value in (None, "", [], {}):
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _safe_date(value: str | None) -> date | None:
    if not value:
        return None
    try:
        return datetime.fromisoformat(value[:10]).date()
    except ValueError:
        return None


def _latest_by_date(items: list[dict[str, Any]]) -> dict[str, Any] | None:
    dated = []
    for item in items:
        d = _safe_date(str(item.get("date") or ""))
        if d:
            dated.append((d, item))
    if not dated:
        return None
    dated.sort(key=lambda x: x[0])
    return dated[-1][1]


def _avg(values: list[float]) -> float | None:
    nums = [v for v in values if v is not None]
    if not nums:
        return None
    return sum(nums) / len(nums)


def _add_alert(
    alerts: list[dict[str, Any]],
    severity: str,
    signal: str,
    title: str,
    explanation: str,
    recommendation: str,
):
    priority_map = {"high": 3, "medium": 2, "low": 1, "info": 0}
    alerts.append(
        {
            "severity": severity,
            "signal": signal,
            "title": title,
            "explanation": explanation,
            "recommendation": recommendation,
            "priority": priority_map.get(severity, 0),
        }
    )


def _tomorrow_watch(
    scheduled_workouts: list[dict[str, Any]],
    readiness_score: float | None,
    fatigue_score: int,
) -> dict[str, Any] | None:
    today = date.today()
    tomorrow = date.fromordinal(today.toordinal() + 1)

    upcoming = []
    for workout in scheduled_workouts or []:
        d = _safe_date(str(workout.get("scheduled_date") or ""))
        if d and d >= today:
            upcoming.append((d, workout))
    if not upcoming:
        return None

    upcoming.sort(key=lambda x: x[0])
    w_date, workout = upcoming[0]
    is_tomorrow = w_date == tomorrow

    risk = "low"
    if fatigue_score >= 3 or (readiness_score is not None and readiness_score < 35):
        risk = "high"
    elif fatigue_score >= 2 or (readiness_score is not None and readiness_score < 60):
        risk = "medium"

    if risk == "high":
        recommendation = "Consider reducing intensity by one zone or replacing with easy aerobic running."
    elif risk == "medium":
        recommendation = "Keep the session, but cap effort and monitor HRV/readiness in the morning."
    else:
        recommendation = "You are trending well for the next workout. Keep fueling and hydration consistent."

    return {
        "date": w_date.isoformat(),
        "is_tomorrow": is_tomorrow,
        "workout_name": workout.get("name") or "Workout",
        "estimated_distance_m": _num(workout.get("estimated_distance_m")),
        "estimated_duration_s": _num(workout.get("estimated_duration_s")),
        "risk": risk,
        "recommendation": recommendation,
    }


def compute_recovery_alerts(
    garmin_data: dict | None, training_data: dict | None = None
) -> dict:
    garmin_data = garmin_data or {}
    training_data = training_data or {}

    sleep_rows = garmin_data.get("sleep") or []
    stress_rows = garmin_data.get("stress") or []
    bb_rows = garmin_data.get("body_battery") or []
    readiness_rows = training_data.get("readiness_trend") or []
    scheduled_workouts = training_data.get("scheduled_workouts") or []

    latest_sleep = _latest_by_date(sleep_rows)
    latest_stress = _latest_by_date(stress_rows)
    latest_bb = _latest_by_date(bb_rows)
    latest_readiness = _latest_by_date(readiness_rows)

    sleep_hours_last = None
    if latest_sleep:
        sleep_hours_last = (_num(latest_sleep.get("duration_s")) or 0.0) / 3600.0
    sleep_hours_7d = _avg(
        [(_num(row.get("duration_s")) or 0.0) / 3600.0 for row in sleep_rows[-7:]]
    )
    stress_last = _num((latest_stress or {}).get("avg_stress"))
    body_battery_last = _num((latest_bb or {}).get("end_level"))
    readiness_score = _num((latest_readiness or {}).get("score"))
    hrv_last = _num(garmin_data.get("hrv"))
    hrv_baseline_low = _num(garmin_data.get("hrv_baseline_low"))
    hrv_baseline_high = _num(garmin_data.get("hrv_baseline_high"))
    training_load = _num(garmin_data.get("training_load"))
    chronic_load = _num(garmin_data.get("chronic_load"))

    alerts: list[dict[str, Any]] = []
    fatigue_markers = 0

    if readiness_score is not None:
        if readiness_score < 35:
            fatigue_markers += 2
            _add_alert(
                alerts,
                "high",
                "readiness",
                "Low training readiness",
                f"Your latest readiness score is {int(readiness_score)}, which is in a low-readiness zone.",
                "Plan easy mileage, mobility, and sleep focus before your next hard workout.",
            )
        elif readiness_score < 60:
            fatigue_markers += 1
            _add_alert(
                alerts,
                "medium",
                "readiness",
                "Moderate readiness",
                f"Your readiness score is {int(readiness_score)}, suggesting partial recovery.",
                "Keep quality work but reduce total volume by 10-20% for 24 hours.",
            )

    if sleep_hours_last is not None:
        if sleep_hours_last < 5.0:
            fatigue_markers += 2
            _add_alert(
                alerts,
                "high",
                "sleep",
                "Short sleep duration",
                f"Last night was {sleep_hours_last:.1f} hours, which is below typical recovery targets.",
                "Shift the next session to easy effort and target an early bedtime tonight.",
            )
        elif sleep_hours_last < 6.5:
            fatigue_markers += 1
            _add_alert(
                alerts,
                "medium",
                "sleep",
                "Sleep below ideal range",
                f"Last night was {sleep_hours_last:.1f} hours.",
                "Prioritize sleep extension and avoid stacking hard sessions back-to-back.",
            )

    if hrv_last is not None and hrv_baseline_low is not None:
        if hrv_last < hrv_baseline_low * 0.92:
            fatigue_markers += 2
            _add_alert(
                alerts,
                "high",
                "hrv",
                "HRV suppressed below baseline",
                f"HRV is {hrv_last:.1f}, below your baseline low of {hrv_baseline_low:.1f}.",
                "Keep intensity low today and retest readiness tomorrow morning.",
            )
        elif hrv_last < hrv_baseline_low:
            fatigue_markers += 1
            _add_alert(
                alerts,
                "medium",
                "hrv",
                "HRV trending low",
                f"HRV is {hrv_last:.1f}, slightly below your baseline low of {hrv_baseline_low:.1f}.",
                "Use a shorter aerobic session and monitor overnight recovery signals.",
            )

    if stress_last is not None:
        if stress_last >= 70:
            fatigue_markers += 2
            _add_alert(
                alerts,
                "high",
                "stress",
                "High stress load",
                f"Recent average stress is {int(stress_last)}/100.",
                "Add recovery work today and keep running intensity controlled.",
            )
        elif stress_last >= 55:
            fatigue_markers += 1
            _add_alert(
                alerts,
                "medium",
                "stress",
                "Elevated stress",
                f"Recent average stress is {int(stress_last)}/100.",
                "Keep effort conversational and use downregulation after training.",
            )

    if body_battery_last is not None:
        if body_battery_last < 25:
            fatigue_markers += 2
            _add_alert(
                alerts,
                "high",
                "body_battery",
                "Low body battery",
                f"Body Battery ended at {int(body_battery_last)}/100.",
                "Keep the next run easy and shorten duration until charge rebounds.",
            )
        elif body_battery_last < 45:
            fatigue_markers += 1
            _add_alert(
                alerts,
                "medium",
                "body_battery",
                "Body battery not fully recharged",
                f"Body Battery is {int(body_battery_last)}/100.",
                "Run easy or moderate only; defer hard intervals if possible.",
            )

    if training_load is not None and chronic_load not in (None, 0):
        load_ratio = training_load / chronic_load
        if load_ratio >= 1.6:
            fatigue_markers += 2
            _add_alert(
                alerts,
                "high",
                "load",
                "Acute load spike",
                f"Acute/chronic load ratio is {load_ratio:.2f}.",
                "Reduce workload over the next 2-3 days to avoid overload risk.",
            )
        elif load_ratio >= 1.35:
            fatigue_markers += 1
            _add_alert(
                alerts,
                "medium",
                "load",
                "Training load rising quickly",
                f"Acute/chronic load ratio is {load_ratio:.2f}.",
                "Maintain intensity but lower total volume until ratio stabilizes.",
            )

    severe_count = len([a for a in alerts if a["severity"] == "high"])
    moderate_count = len([a for a in alerts if a["severity"] == "medium"])
    if severe_count >= 2:
        _add_alert(
            alerts,
            "high",
            "combined",
            "Multiple recovery flags",
            "Several key signals indicate stacked fatigue right now.",
            "Use a recovery day or easy aerobic-only day before the next quality session.",
        )

    alerts.sort(key=lambda item: item.get("priority", 0), reverse=True)

    tomorrow_watch = _tomorrow_watch(
        scheduled_workouts=scheduled_workouts,
        readiness_score=readiness_score,
        fatigue_score=fatigue_markers,
    )

    status = "green"
    status_message = "Recovery signals are stable. You can proceed with planned training."
    if severe_count > 0:
        status = "red"
        status_message = "Recovery risk is elevated. Adjust intensity before the next hard session."
    elif moderate_count > 0:
        status = "yellow"
        status_message = "Some recovery signals are mixed. Monitor closely over the next 24 hours."

    readiness_snapshot = {
        "date": str((latest_readiness or {}).get("date") or date.today().isoformat()),
        "readiness_score": int(readiness_score) if readiness_score is not None else None,
        "sleep_hours_last": round(sleep_hours_last, 1) if sleep_hours_last is not None else None,
        "sleep_hours_7d_avg": round(sleep_hours_7d, 1) if sleep_hours_7d is not None else None,
        "stress_last": int(stress_last) if stress_last is not None else None,
        "body_battery_last": int(body_battery_last) if body_battery_last is not None else None,
        "hrv_last": round(hrv_last, 1) if hrv_last is not None else None,
        "hrv_baseline_low": round(hrv_baseline_low, 1) if hrv_baseline_low is not None else None,
        "hrv_baseline_high": round(hrv_baseline_high, 1) if hrv_baseline_high is not None else None,
    }

    if not alerts:
        alerts.append(
            {
                "severity": "info",
                "signal": "positive",
                "title": "Recovery signals look good",
                "explanation": "No major red flags were detected across sleep, HRV, stress, and readiness.",
                "recommendation": "Proceed with your plan and keep current recovery habits consistent.",
                "priority": 0,
            }
        )

    return {
        "status": status,
        "status_message": status_message,
        "generated_at": datetime.utcnow().isoformat() + "Z",
        "snapshot": readiness_snapshot,
        "prioritized_alerts": alerts,
        "tomorrow_watch": tomorrow_watch,
        "sources": {
            "garmin_data_fields": [
                "hrv",
                "hrv_baseline_low",
                "hrv_baseline_high",
                "sleep",
                "stress",
                "body_battery",
                "training_load",
                "chronic_load",
            ],
            "training_data_fields": ["readiness_trend", "scheduled_workouts"],
        },
    }
