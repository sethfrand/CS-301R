from __future__ import annotations

import json
import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

M_PER_MI = 1609.34


def _to_float(value: Any) -> float | None:
    if value in (None, "", [], {}):
        return None
    try:
        return float(value)
    except Exception:
        return None


def _extract_first_number(text: Any) -> float | None:
    if text in (None, "", [], {}):
        return None
    m = re.search(r"[-+]?\d+(?:\.\d+)?", str(text))
    return float(m.group()) if m else None


def _normalize_name(name: Any) -> str:
    raw = str(name or "").strip()
    return re.sub(r"\s+", " ", raw).strip()


def _slug_tokens(text: str) -> set[str]:
    return {t for t in re.findall(r"[a-z0-9]+", text.lower()) if len(t) > 1}


def _infer_usage_tags(text: str) -> set[str]:
    t = text.lower()
    tags: set[str] = set()
    if "daily" in t or "easy" in t:
        tags.add("daily")
    if "tempo" in t or "threshold" in t:
        tags.add("tempo")
    if "interval" in t or "track" in t or "speed" in t:
        tags.add("speed")
    if "long" in t:
        tags.add("long")
    if "race" in t or "racing" in t:
        tags.add("race")
    if "trail" in t:
        tags.add("trail")
    if "recovery" in t:
        tags.add("recovery")
    if not tags:
        tags.add("daily")
    return tags


def _infer_support(text: str) -> str | None:
    t = text.lower()
    if "stability" in t:
        return "stability"
    if "neutral" in t:
        return "neutral"
    if "motion control" in t:
        return "motion-control"
    return None


def _run_type_from_activity(run: dict[str, Any]) -> str:
    name = str(run.get("name") or run.get("activityName") or "").lower()
    te = _to_float(run.get("training_effect") or run.get("aerobicTrainingEffect"))
    dist_m = _to_float(run.get("distance")) or 0.0
    dur_s = _to_float(run.get("duration_in_seconds") or run.get("duration")) or 0.0
    pace_s_mi = dur_s / (dist_m / M_PER_MI) if dist_m > 0 and dur_s > 0 else None

    if any(k in name for k in ("long", "lr")) or dist_m >= 19312:  # >= 12mi
        return "long"
    if any(k in name for k in ("interval", "track", "repeat", "fartlek")):
        return "speed"
    if any(k in name for k in ("tempo", "threshold", "steady")):
        return "tempo"
    if any(k in name for k in ("recovery", "easy")):
        return "recovery"
    if pace_s_mi is not None and pace_s_mi <= 430:
        return "speed"
    if te is not None and te >= 3.8:
        return "tempo"
    return "daily"


def _run_type_from_scheduled(workout: dict[str, Any]) -> str:
    text = f"{workout.get('name','')} {workout.get('description','')}".lower()
    if any(k in text for k in ("long", "marathon-pace long")):
        return "long"
    if any(k in text for k in ("interval", "track", "repeat", "strides", "fartlek")):
        return "speed"
    if any(k in text for k in ("tempo", "threshold", "steady", "progression")):
        return "tempo"
    if any(k in text for k in ("recovery", "easy")):
        return "recovery"
    return "daily"


def _load_catalog(catalog_path: str | None) -> list[dict[str, Any]]:
    path = Path(catalog_path) if catalog_path else Path("shoe-chatbot/runrepeat_shoes.json")
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return []
    if not isinstance(raw, list):
        return []

    out: list[dict[str, Any]] = []
    for item in raw:
        if not isinstance(item, dict):
            continue
        specs = item.get("specs") or {}
        lab = item.get("lab_results") or {}
        model_raw = _normalize_name(item.get("model"))
        model = re.sub(r"\s+review$", "", model_raw, flags=re.I)
        pace_blob = str(specs.get("Comparison — Pace") or specs.get("Pace") or "")
        support_blob = str(
            specs.get("Comparison — Arch support")
            or specs.get("Arch support:")
            or lab.get("Arch support:")
            or ""
        )
        audience_blob = str(specs.get("Comparison — Audience score") or item.get("score") or "")
        weight_blob = str(lab.get("Weight") or specs.get("Comparison — Weight lab\nWeight brand") or "")
        drop_blob = str(lab.get("Drop") or specs.get("Comparison — Drop lab\nDrop brand") or "")

        weight_oz = None
        weight_match = re.search(r"(\d+(?:\.\d+)?)\s*oz", weight_blob.lower())
        if weight_match:
            weight_oz = _to_float(weight_match.group(1))
        elif "g" in weight_blob.lower():
            grams = _extract_first_number(weight_blob)
            if grams:
                weight_oz = grams / 28.3495

        out.append(
            {
                "model": model or model_raw or "Unknown",
                "url": item.get("url") or "",
                "usage_tags": sorted(_infer_usage_tags(pace_blob)),
                "support": _infer_support(support_blob),
                "weight_oz": weight_oz,
                "drop_mm": _extract_first_number(drop_blob),
                "audience_score": _extract_first_number(audience_blob),
                "pace_blob": pace_blob,
                "support_blob": support_blob,
            }
        )
    return out


def _best_catalog_profile_for_name(name: str, catalog: list[dict[str, Any]]) -> dict[str, Any] | None:
    target = _slug_tokens(name)
    if not target:
        return None
    best: tuple[float, dict[str, Any] | None] = (0.0, None)
    for candidate in catalog:
        c_tokens = _slug_tokens(str(candidate.get("model")))
        if not c_tokens:
            continue
        inter = len(target & c_tokens)
        union = len(target | c_tokens) or 1
        score = inter / union
        if score > best[0]:
            best = (score, candidate)
    return best[1] if best[0] >= 0.2 else None


def _replacement_candidates(
    current: dict[str, Any], catalog: list[dict[str, Any]], top_n: int = 3
) -> list[dict[str, Any]]:
    current_name = str(current.get("name") or "")
    current_profile = _best_catalog_profile_for_name(current_name, catalog) or {}
    current_usage = set(current_profile.get("usage_tags") or _infer_usage_tags(current_name))
    current_support = current_profile.get("support") or _infer_support(current_name)
    current_weight = _to_float(current_profile.get("weight_oz"))
    current_drop = _to_float(current_profile.get("drop_mm"))

    scored: list[tuple[float, dict[str, Any]]] = []
    current_tokens = _slug_tokens(current_name)
    for cand in catalog:
        model = str(cand.get("model") or "")
        cand_tokens = _slug_tokens(model)
        if current_tokens and len(current_tokens & cand_tokens) >= max(1, int(len(current_tokens) * 0.6)):
            continue

        c_usage = set(cand.get("usage_tags") or [])
        inter = len(current_usage & c_usage)
        union = len(current_usage | c_usage) or 1
        usage_score = inter / union

        support_score = 1.0 if current_support and cand.get("support") == current_support else 0.0

        weight_score = 0.0
        c_weight = _to_float(cand.get("weight_oz"))
        if current_weight and c_weight:
            diff = abs(current_weight - c_weight)
            weight_score = 1.0 if diff <= 0.7 else 0.7 if diff <= 1.2 else 0.35 if diff <= 2.0 else 0.0

        drop_score = 0.0
        c_drop = _to_float(cand.get("drop_mm"))
        if current_drop and c_drop:
            diff = abs(current_drop - c_drop)
            drop_score = 1.0 if diff <= 1.5 else 0.7 if diff <= 3.0 else 0.35 if diff <= 5.0 else 0.0

        audience = (_to_float(cand.get("audience_score")) or 0.0) / 100.0
        score = usage_score * 40 + support_score * 18 + weight_score * 12 + drop_score * 12 + audience * 10
        scored.append((score, cand))

    scored.sort(key=lambda x: x[0], reverse=True)
    out = []
    for score, cand in scored[:top_n]:
        out.append(
            {
                "model": cand.get("model"),
                "url": cand.get("url"),
                "match_score": round(score, 1),
                "weight_oz": cand.get("weight_oz"),
                "drop_mm": cand.get("drop_mm"),
                "support": cand.get("support"),
                "usage_tags": cand.get("usage_tags"),
                "audience_score": cand.get("audience_score"),
            }
        )
    return out


def compute_shoe_rotation_insights(
    athlete_context: dict | None,
    training_data: dict | None = None,
    shoe_catalog_path: str | None = None,
) -> dict:
    athlete_context = athlete_context or {}
    training_data = training_data or {}
    strava = athlete_context.get("strava") if isinstance(athlete_context, dict) else {}
    garmin = athlete_context.get("garmin") if isinstance(athlete_context, dict) else {}
    strava_shoes = strava.get("shoes") if isinstance(strava, dict) else []
    recent_runs = garmin.get("recent_runs") if isinstance(garmin, dict) else []
    scheduled = training_data.get("scheduled_workouts") if isinstance(training_data, dict) else []
    if not isinstance(strava_shoes, list):
        strava_shoes = []
    if not isinstance(recent_runs, list):
        recent_runs = []
    if not isinstance(scheduled, list):
        scheduled = []

    catalog = _load_catalog(shoe_catalog_path)

    normalized_shoes: list[dict[str, Any]] = []
    total_distance_m = 0.0
    for shoe in strava_shoes:
        if not isinstance(shoe, dict):
            continue
        name = _normalize_name(shoe.get("name") or shoe.get("model") or "Unknown")
        dist_m = _to_float(shoe.get("distance")) or 0.0
        retire_m = _to_float(shoe.get("retire_distance")) or 800000.0
        wear_pct = min(1.5, (dist_m / retire_m) if retire_m > 0 else 0.0)
        total_distance_m += dist_m

        if wear_pct >= 1.0:
            wear_level = "retire-now"
        elif wear_pct >= 0.85:
            wear_level = "high-risk"
        elif wear_pct >= 0.70:
            wear_level = "watch"
        else:
            wear_level = "healthy"

        profile = _best_catalog_profile_for_name(name, catalog) or {}
        usage_tags = profile.get("usage_tags") or sorted(_infer_usage_tags(name))
        support = profile.get("support") or _infer_support(name) or "unknown"

        normalized_shoes.append(
            {
                "name": name,
                "id": shoe.get("id"),
                "distance_m": round(dist_m, 1),
                "distance_mi": round(dist_m / M_PER_MI, 1),
                "retire_distance_m": round(retire_m, 1),
                "retire_distance_mi": round(retire_m / M_PER_MI, 1),
                "wear_pct": round(wear_pct, 3),
                "wear_level": wear_level,
                "primary": bool(shoe.get("primary")),
                "support_type": support,
                "usage_tags": usage_tags,
                "weight_oz": profile.get("weight_oz"),
                "drop_mm": profile.get("drop_mm"),
            }
        )

    normalized_shoes.sort(key=lambda s: s["wear_pct"], reverse=True)
    active_shoes = [s for s in normalized_shoes if s["distance_m"] > 0]
    worn_shoes = [s for s in normalized_shoes if s["wear_pct"] >= 0.7]
    underused_shoes = [s for s in normalized_shoes if 0 <= s["wear_pct"] <= 0.2 and s["distance_m"] > 0]

    recent_type_counts: dict[str, int] = {}
    for run in recent_runs:
        if not isinstance(run, dict):
            continue
        r_type = _run_type_from_activity(run)
        recent_type_counts[r_type] = recent_type_counts.get(r_type, 0) + 1

    scheduled_type_counts: dict[str, int] = {}
    for workout in scheduled:
        if not isinstance(workout, dict):
            continue
        w_type = _run_type_from_scheduled(workout)
        scheduled_type_counts[w_type] = scheduled_type_counts.get(w_type, 0) + 1

    combined_demand: dict[str, int] = {}
    for key in set(recent_type_counts) | set(scheduled_type_counts):
        combined_demand[key] = recent_type_counts.get(key, 0) + scheduled_type_counts.get(key, 0)
    dominant_demand = sorted(combined_demand.items(), key=lambda x: x[1], reverse=True)

    suggested_use = []
    for shoe in normalized_shoes:
        tags = set(shoe.get("usage_tags") or [])
        demand_tags = [tag for tag, _ in dominant_demand[:3]]
        aligned = [tag for tag in demand_tags if tag in tags]
        if shoe["wear_pct"] >= 0.85:
            recommendation = "Use for short easy/recovery runs only; plan replacement soon."
        elif shoe["wear_pct"] >= 0.7:
            recommendation = "Limit to easy mileage while rotating fresher shoes for quality sessions."
        elif aligned:
            recommendation = f"Best for {', '.join(aligned)} sessions based on your current training demand."
        elif "daily" in tags:
            recommendation = "Use as your daily mileage workhorse."
        elif "tempo" in tags or "speed" in tags:
            recommendation = "Reserve for workouts and faster days."
        else:
            recommendation = "Use as a secondary rotation option to spread wear."

        suggested_use.append(
            {
                "name": shoe["name"],
                "wear_pct": shoe["wear_pct"],
                "distance_m": shoe["distance_m"],
                "distance_mi": shoe["distance_mi"],
                "support_type": shoe["support_type"],
                "recommended_use": recommendation,
                "usage_tags": shoe.get("usage_tags") or [],
            }
        )

    replacement_plan: list[dict[str, Any]] = []
    if worn_shoes:
        top_worn = worn_shoes[0]
        options = _replacement_candidates(top_worn, catalog, top_n=3)
        replacement_plan.append(
            {
                "current_shoe": top_worn["name"],
                "current_wear_pct": top_worn["wear_pct"],
                "current_distance_mi": top_worn["distance_mi"],
                "replacement_options": options,
                "selection_basis": {
                    "intended_use": True,
                    "support_type": True,
                    "weight_drop_similarity": True,
                    "audience_score": True,
                },
            }
        )

    avg_wear = (sum(s["wear_pct"] for s in normalized_shoes) / len(normalized_shoes)) if normalized_shoes else 0.0
    summary = {
        "shoe_count": len(normalized_shoes),
        "active_shoe_count": len(active_shoes),
        "worn_shoe_count": len(worn_shoes),
        "underused_shoe_count": len(underused_shoes),
        "total_distance_m": round(total_distance_m, 1),
        "total_distance_mi": round(total_distance_m / M_PER_MI, 1),
        "average_wear_pct": round(avg_wear, 3),
        "dominant_demand": [{"type": k, "count": v} for k, v in dominant_demand[:4]],
    }

    return {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "source_summary": {
            "strava_shoes_count": len(strava_shoes),
            "garmin_recent_runs_count": len(recent_runs),
            "scheduled_workouts_count": len(scheduled),
            "shoe_catalog_count": len(catalog),
            "shoe_catalog_path": str(shoe_catalog_path or "shoe-chatbot/runrepeat_shoes.json"),
        },
        "rotation_summary": summary,
        "worn_shoes": worn_shoes,
        "underused_shoes": underused_shoes,
        "per_shoe_suggested_use": suggested_use,
        "replacement_plan": replacement_plan,
        "demand_profile": {
            "recent_run_types": recent_type_counts,
            "scheduled_workout_types": scheduled_type_counts,
            "combined_training_demand": combined_demand,
        },
    }
