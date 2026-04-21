"""
server.py — RunRec backend
pip install fastapi uvicorn chromadb openai tiktoken httpx garminconnect
export OPENAI_API_KEY=sk-...
python server.py
"""

import os, asyncio, hashlib, secrets, urllib.parse, json, re
from datetime import datetime, timedelta, date
from typing import Any, Optional

from fastapi import FastAPI, HTTPException, Query, Header, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import RedirectResponse
from pydantic import BaseModel
import chromadb
from openai import OpenAI
import httpx
from insights.long_term_analytics import compute_long_term_analytics
from insights.recovery_alerts import compute_recovery_alerts
from insights.shoe_rotation import compute_shoe_rotation_insights
from shoe_prices import (
    find_buy_links, find_buy_links_multi,
    extract_shoe_models_from_text, format_buy_links_as_citations,
)

CHROMA_DIR    = "chroma_db_openai"
COLLECTION    = "running_shoes"
CHAT_MODEL    = "gpt-5.4-nano"           # Fixed: was "gpt 5.4" (invalid model name)
N_RESULTS     = 5
STRAVA_BASE   = "https://www.strava.com/api/v3"
SHOE_CATALOG_PATH = "shoe-chatbot/runrepeat_shoes.json"
M_PER_MI      = 1609.34
LLM_CONFIG_FILE = os.path.join(os.path.dirname(__file__), ".runrec_llm.json")

# Directory where garth OAuth tokens are cached between server restarts.
# Prevents repeated SSO hits that trigger Garmin 429 rate limits.
GARMIN_TOKEN_DIR = os.path.expanduser("~/.garth")

# Optional path to an AGENTS.md file whose contents are prepended to the
# system prompt. Set to a relative or absolute path, e.g.:
AGENTS_MD_PATH = "AGENTS.md"
#   AGENTS_MD_PATH = "/Users/you/projects/runrec/AGENTS.md"
# Leave as None to skip.
# AGENTS_MD_PATH: Optional[str] = None


def _load_local_env(path: str = ".env", override: bool = True) -> None:
    try:
        with open(path, "r", encoding="utf-8") as env_file:
            for raw_line in env_file:
                line = raw_line.strip()
                if not line or line.startswith("#"):
                    continue
                if line.startswith("export "):
                    line = line[7:].strip()
                if "=" not in line:
                    continue
                key, value = line.split("=", 1)
                key = key.strip()
                value = value.strip().strip('"').strip("'")
                if key and value and (override or key not in os.environ):
                    os.environ[key] = value
    except FileNotFoundError:
        pass
    except Exception as e:
        print(f"[ENV] WARNING: could not read {path}: {e}")


_load_local_env()


def _masked_search_key(env_var: str = "YOU_API_KEY") -> Optional[str]:
    key = os.environ.get(env_var, "").strip()
    if not key:
        return None
    if len(key) <= 12:
        return "*" * len(key)
    return f"{key[:12]}...{key[-8:]}"



# ---- Async Garmin Rate Limiter ----
GARMIN_CONCURRENCY = 3
GARMIN_DELAY = 0.4

_garmin_sem = asyncio.Semaphore(GARMIN_CONCURRENCY)

async def garmin_call(fn, *args, retries=3, base_delay=1.5):
    for attempt in range(retries):
        async with _garmin_sem:
            try:
                result = await asyncio.to_thread(fn, *args)
                await asyncio.sleep(GARMIN_DELAY + (0.1 * attempt))
                return result
            except Exception as e:
                msg = str(e)
                if "429" in msg or "Too Many Requests" in msg:
                    wait = base_delay * (2 ** attempt) + (0.2 * attempt)
                    print(f"[Garmin 429] retrying in {wait:.2f}s...")
                    await asyncio.sleep(wait)
                else:
                    raise
    return None



def _load_agents_md() -> str:
    """Read AGENTS.md and return its contents, or empty string if not set/found."""
    if not AGENTS_MD_PATH:
        return ""
    path = os.path.expanduser(os.path.abspath(AGENTS_MD_PATH))
    try:
        with open(path, "r", encoding="utf-8") as f:
            text = f.read().strip()
        print(f"[AGENTS.md] Loaded {len(text)} chars from {path}")
        return text
    except FileNotFoundError:
        print(f"[AGENTS.md] WARNING: file not found at {path}")
        return ""
    except Exception as e:
        print(f"[AGENTS.md] WARNING: could not read file: {e}")
        return ""

_agents_md: str = _load_agents_md()

_pin_hash:       Optional[str] = None
_session_tok:    Optional[str] = None
_garmin_cli                    = None
_garmin_email:   Optional[str] = None
_frontend_origin:Optional[str] = None
_shoe_catalog: Optional[list[dict[str, Any]]] = None


def _normalize_base_url(url: Optional[str]) -> str:
    raw = str(url or "").strip()
    if not raw:
        return ""
    if not re.match(r"^https?://", raw, flags=re.I):
        raw = f"http://{raw}"
    parsed = urllib.parse.urlparse(raw)
    path = parsed.path.rstrip("/")
    if not path:
        path = "/v1"
    normalized = parsed._replace(path=path, params="", query="", fragment="")
    return urllib.parse.urlunparse(normalized).rstrip("/")


def _load_llm_config() -> dict[str, Any]:
    try:
        with open(LLM_CONFIG_FILE, "r", encoding="utf-8") as llm_file:
            data = json.load(llm_file)
        return data if isinstance(data, dict) else {}
    except Exception:
        return {}


def _save_llm_config(data: dict[str, Any]) -> None:
    with open(LLM_CONFIG_FILE, "w", encoding="utf-8") as llm_file:
        json.dump(data, llm_file)


_llm_settings: dict[str, Any] = _load_llm_config()


def _effective_llm_settings() -> dict[str, Any]:
    provider = str(os.environ.get("LLM_PROVIDER") or _llm_settings.get("provider") or "").strip().lower()
    openai_api_key = str(os.environ.get("RUNREC_OPENAI_API_KEY") or _llm_settings.get("openai_api_key") or "").strip()
    openai_model = str(os.environ.get("OPENAI_MODEL") or _llm_settings.get("openai_model") or CHAT_MODEL).strip() or CHAT_MODEL
    local_base_url = _normalize_base_url(os.environ.get("LOCAL_LLM_BASE_URL") or _llm_settings.get("local_base_url"))
    local_model = str(os.environ.get("LOCAL_LLM_MODEL") or _llm_settings.get("local_model") or "").strip()
    local_api_key = str(os.environ.get("LOCAL_LLM_API_KEY") or _llm_settings.get("local_api_key") or "").strip()

    if provider not in {"openai", "local"}:
        provider = "openai"

    openai_available = bool(openai_api_key or os.environ.get("OPENAI_API_KEY", "").strip())
    local_available = bool(local_base_url and local_model)
    configured = openai_available if provider == "openai" else local_available

    return {
        "provider": provider,
        "configured": configured,
        "openai_available": openai_available,
        "openai_api_key": openai_api_key,
        "openai_uses_env_key": bool(os.environ.get("OPENAI_API_KEY", "").strip()) and not openai_api_key,
        "openai_model": openai_model,
        "local_available": local_available,
        "local_base_url": local_base_url,
        "local_model": local_model,
        "local_api_key": local_api_key,
    }


# Strava credentials are written to disk so they survive server restarts
# and uvicorn reload cycles. File is local-only; never committed.
_CREDS_FILE = os.path.join(os.path.dirname(__file__), ".runrec_strava.json")

def _load_strava_creds() -> tuple[Optional[str], Optional[str]]:
    try:
        import json as _json
        with open(_CREDS_FILE) as _f:
            _d = _json.load(_f)
        return _d.get("client_id"), _d.get("client_secret")
    except Exception:
        return None, None

def _save_strava_creds(cid: str, csec: str):
    import json as _json
    with open(_CREDS_FILE, "w") as _f:
        _json.dump({"client_id": cid, "client_secret": csec}, _f)

_strava_id, _strava_sec = _load_strava_creds()

def _week_start_key(raw_date: str) -> Optional[str]:
    if not raw_date:
        return None
    try:
        dt = datetime.fromisoformat(raw_date[:10])
    except ValueError:
        return None
    return (dt - timedelta(days=dt.weekday())).strftime("%Y-%m-%d")

def _build_weekly_trend_from_runs(
    runs: list[dict[str, Any]] | None,
    *,
    date_field: str,
    distance_field: str,
    count: int = 12,
    today_dt: Optional[date | datetime] = None,
) -> list[dict[str, float | str]]:
    weekly: dict[str, float] = {}
    for run in runs or []:
        week_key = _week_start_key(run.get(date_field) or "")
        if not week_key:
            continue
        weekly.setdefault(week_key, 0.0)
        weekly[week_key] += float(run.get(distance_field) or 0.0)
    return _build_last_n_weeks(weekly, count=count, today_dt=today_dt)

def _build_last_n_weeks(weekly: dict[str, float], count: int = 12, today_dt: Optional[datetime] = None) -> list[dict[str, float | str]]:
    anchor = today_dt.date() if isinstance(today_dt, datetime) else today_dt
    anchor = anchor or date.today()
    current_monday = anchor - timedelta(days=anchor.weekday())
    weeks = []
    for index in range(count - 1, -1, -1):
        week_start = current_monday - timedelta(days=7 * index)
        key = week_start.strftime("%Y-%m-%d")
        weeks.append({"week": key, "distance_m": float(weekly.get(key, 0.0))})
    return weeks

async def _fetch_strava_activities(
    client: httpx.AsyncClient,
    headers: dict[str, str],
    since_ts: int,
    per_page: int = 100,
    max_pages: int = 10,
) -> list[dict[str, Any]]:
    activities: list[dict[str, Any]] = []
    for page in range(1, max_pages + 1):
        response = await client.get(
            f"{STRAVA_BASE}/athlete/activities",
            headers=headers,
            params={"after": since_ts, "per_page": per_page, "page": page},
        )
        response.raise_for_status()
        batch = response.json()
        if not isinstance(batch, list) or not batch:
            break
        activities.extend(batch)
        if len(batch) < per_page:
            break
    return activities

app = FastAPI()
_CORS = ([f"http://localhost:{p}" for p in range(5173,5182)] +
         [f"http://127.0.0.1:{p}" for p in range(5173,5182)])
app.add_middleware(CORSMiddleware, allow_origins=_CORS, allow_credentials=True,
                   allow_methods=["*"], allow_headers=["*"])

# ---------------------------------------------------------------------------
# Background auto-refresh cache for Intervals.icu + Strava
# Fetched on demand and refreshed every REFRESH_INTERVAL_MINUTES in the bg.
# ---------------------------------------------------------------------------
REFRESH_INTERVAL_MINUTES = 30
_cached_intervals_data: Optional[dict] = None
_cached_strava_data:    Optional[dict] = None
_last_refresh_at:       Optional[datetime] = None
_refresh_lock = asyncio.Lock()

async def _bg_refresh_loop():
    """Background task: refresh Intervals + Strava data periodically."""
    while True:
        await asyncio.sleep(REFRESH_INTERVAL_MINUTES * 60)
        try:
            await _do_refresh()
        except Exception as e:
            print(f"[AutoRefresh] Error: {e}")

async def _do_refresh():
    global _cached_intervals_data, _last_refresh_at
    async with _refresh_lock:
        refreshed = []
        if _intervals_athlete_id and _intervals_api_key:
            try:
                _cached_intervals_data = await _fetch_intervals_data()
                refreshed.append("intervals")
            except Exception as e:
                print(f"[AutoRefresh] Intervals failed: {e}")
        _last_refresh_at = datetime.utcnow()
        if refreshed:
            print(f"[AutoRefresh] Refreshed: {', '.join(refreshed)} at {_last_refresh_at.isoformat()}")

@app.on_event("startup")
async def startup_event():
    asyncio.create_task(_bg_refresh_loop())
    print(f"[AutoRefresh] Background refresh task started (every {REFRESH_INTERVAL_MINUTES}min)")


def _llm_client():
    cfg = _effective_llm_settings()
    provider = cfg["provider"]
    if provider == "openai":
        api_key = cfg["openai_api_key"] or os.environ.get("OPENAI_API_KEY", "").strip()
        if not api_key:
            raise HTTPException(500, "No OpenAI API key configured")
        return OpenAI(api_key=api_key), cfg["openai_model"], provider

    if not cfg["local_base_url"] or not cfg["local_model"]:
        raise HTTPException(500, "Local model is not configured")
    return (
        OpenAI(base_url=cfg["local_base_url"], api_key=cfg["local_api_key"] or "tailscale-local"),
        cfg["local_model"],
        provider,
    )


def _chat_completion(messages: list[dict[str, str]], *, max_tokens: int = 1000, temperature: float = 0.7) -> str:
    client, model, provider = _llm_client()
    kwargs = {
        "model": model,
        "messages": messages,
        "temperature": temperature,
    }
    if provider == "openai":
        kwargs["max_completion_tokens"] = max_tokens
    else:
        kwargs["max_tokens"] = max_tokens
    response = client.chat.completions.create(**kwargs)
    return response.choices[0].message.content or ""

def _hp(pin):
    return hashlib.sha256(pin.encode()).hexdigest()

def _auth(tok):
    if _pin_hash and (_session_tok is None or tok != _session_tok):
        raise HTTPException(401,"Unauthorized")

def _capture(req: Request):
    global _frontend_origin
    ref = req.headers.get("referer","")
    if ref:
        from urllib.parse import urlparse as up
        p = up(ref); _frontend_origin = f"{p.scheme}://{p.netloc}"

def _walk_nodes(node: Any):
    if isinstance(node, dict):
        yield node
        for value in node.values():
            yield from _walk_nodes(value)
    elif isinstance(node, list):
        for value in node:
            yield from _walk_nodes(value)

def _pick_nested(node: Any, *paths):
    for path in paths:
        cur = node
        ok = True
        for key in path:
            if isinstance(cur, dict):
                cur = cur.get(key)
            else:
                ok = False
                break
        if ok and cur not in (None, "", [], {}):
            return cur
    return None

def _to_date_str(value: Any) -> Optional[str]:
    if value in (None, "", [], {}):
        return None
    if isinstance(value, dict):
        picked = _pick_nested(
            value,
            ("date",),
            ("calendarDate",),
            ("scheduledDate",),
            ("scheduled_date",),
            ("startDate",),
            ("startTimeLocal",),
            ("displayDate",),
        )
        return _to_date_str(picked)
    if isinstance(value, (int, float)):
        try:
            ts = float(value)
            if ts > 1_000_000_000_000:
                ts /= 1000.0
            return datetime.fromtimestamp(ts).date().isoformat()
        except Exception:
            return None
    if isinstance(value, str):
        s = value.strip()
        if not s:
            return None
        if len(s) >= 10 and s[4] == "-" and s[7] == "-":
            return s[:10]
        return None
    return None

def _extract_resting_hr(value: Any) -> Optional[int]:
    if value in (None, "", [], {}):
        return None
    if isinstance(value, (int, float)):
        try:
            return int(value)
        except Exception:
            return None
    for node in _walk_nodes(value):
        if not isinstance(node, dict):
            continue
        for key in ("restingHeartRate", "restingHR", "value"):
            candidate = _maybe_num(node.get(key), int)
            if candidate:
                return candidate
    return None

def _normalize_sport(value: Any) -> str:
    raw = value
    if isinstance(raw, dict):
        raw = (raw.get("sportTypeKey") or raw.get("typeKey") or raw.get("sportTypeName")
               or raw.get("displayName") or raw.get("name"))
    sport = str(raw or "running").strip().lower()
    if "run" in sport:
        return "running"
    if "cycl" in sport or "bike" in sport:
        return "cycling"
    if "strength" in sport or "gym" in sport:
        return "strength"
    return sport or "other"

def _maybe_num(value: Any, cast=float):
    if value in (None, "", [], {}):
        return None
    try:
        return cast(value)
    except Exception:
        return None

def _normalize_model_name(name: Any) -> str:
    raw = str(name or "").strip()
    raw = re.sub(r"\s+review$", "", raw, flags=re.I)
    return re.sub(r"\s+", " ", raw).strip()

def _slug_tokens(text: Any) -> set[str]:
    return {t for t in re.findall(r"[a-z0-9]+", str(text or "").lower()) if len(t) > 1}

def _extract_first_number(text: Any) -> Optional[float]:
    if text in (None, "", [], {}):
        return None
    m = re.search(r"[-+]?\d+(?:\.\d+)?", str(text))
    return float(m.group()) if m else None

def _infer_usage_tags(text: str) -> list[str]:
    t = str(text or "").lower()
    tags: list[str] = []
    if "daily" in t or "easy" in t:
        tags.append("daily")
    if "tempo" in t or "threshold" in t:
        tags.append("tempo")
    if "interval" in t or "track" in t or "speed" in t:
        tags.append("speed")
    if "long" in t:
        tags.append("long")
    if "race" in t or "racing" in t:
        tags.append("race")
    if "trail" in t:
        tags.append("trail")
    if "recovery" in t:
        tags.append("recovery")
    return tags or ["daily"]

def _infer_support(text: Any) -> Optional[str]:
    t = str(text or "").lower()
    if "stability" in t:
        return "stability"
    if "neutral" in t:
        return "neutral"
    if "motion control" in t:
        return "motion-control"
    return None

def _load_shoe_catalog() -> list[dict[str, Any]]:
    global _shoe_catalog
    if _shoe_catalog is not None:
        return _shoe_catalog
    path = os.path.expanduser(os.path.abspath(SHOE_CATALOG_PATH))
    try:
        with open(path, "r", encoding="utf-8") as f:
            raw = json.load(f)
        _shoe_catalog = raw if isinstance(raw, list) else []
    except Exception:
        _shoe_catalog = []
    return _shoe_catalog

def _catalog_summary(item: dict[str, Any]) -> dict[str, Any]:
    specs = item.get("specs") or {}
    lab = item.get("lab_results") or {}
    pace_blob = str(specs.get("Comparison — Pace") or specs.get("Pace") or "")
    support_blob = str(
        specs.get("Comparison — Arch support")
        or specs.get("Arch support:")
        or lab.get("Arch support:")
        or ""
    )
    weight_blob = str(lab.get("Weight") or specs.get("Comparison — Weight lab\nWeight brand") or "")
    drop_blob = str(lab.get("Drop") or specs.get("Comparison — Drop lab\nDrop brand") or "")

    weight_oz = None
    weight_match = re.search(r"(\d+(?:\.\d+)?)\s*oz", weight_blob.lower())
    if weight_match:
        weight_oz = float(weight_match.group(1))
    elif "g" in weight_blob.lower():
        grams = _extract_first_number(weight_blob)
        if grams:
            weight_oz = grams / 28.3495

    return {
        "model": _normalize_model_name(item.get("model")),
        "url": item.get("url") or "",
        "score": _extract_first_number(item.get("score") or specs.get("Comparison — Audience score")),
        "weight_oz": round(weight_oz, 1) if weight_oz else None,
        "drop_mm": _extract_first_number(drop_blob),
        "support": _infer_support(support_blob),
        "usage_tags": _infer_usage_tags(pace_blob),
        "pros": (item.get("pros") or [])[:3],
        "cons": (item.get("cons") or [])[:3],
        "source": "RunRepeat catalog",
    }

def _search_catalog(query: str, limit: int = 8) -> list[dict[str, Any]]:
    catalog = _load_shoe_catalog()
    q_norm = _normalize_model_name(query)
    q_tokens = _slug_tokens(q_norm)
    ranked: list[tuple[float, dict[str, Any]]] = []
    for item in catalog:
        if not isinstance(item, dict):
            continue
        summary = _catalog_summary(item)
        model = summary["model"]
        model_tokens = _slug_tokens(model)
        if not model:
            continue
        overlap = len(q_tokens & model_tokens)
        union = len(q_tokens | model_tokens) or 1
        score = overlap / union if q_tokens else 0.0
        if q_norm and q_norm.lower() in model.lower():
            score += 1.25
        if q_tokens and score == 0:
            continue
        ranked.append((score, summary))
    ranked.sort(key=lambda pair: (pair[0], pair[1].get("score") or 0), reverse=True)
    return [summary for _, summary in ranked[:limit]]

def _catalog_entry_by_model(model: str) -> Optional[dict[str, Any]]:
    target = _normalize_model_name(model)
    if not target:
        return None
    exact = None
    best: tuple[float, Optional[dict[str, Any]]] = (0.0, None)
    target_tokens = _slug_tokens(target)
    for item in _load_shoe_catalog():
        if not isinstance(item, dict):
            continue
        summary = _catalog_summary(item)
        candidate = summary["model"]
        if candidate.lower() == target.lower():
            exact = summary
            break
        cand_tokens = _slug_tokens(candidate)
        overlap = len(target_tokens & cand_tokens)
        union = len(target_tokens | cand_tokens) or 1
        score = overlap / union
        if target.lower() in candidate.lower():
            score += 0.5
        if score > best[0]:
            best = (score, summary)
    return exact or (best[1] if best[0] >= 0.2 else None)

def _recommended_models_from_response(text: str, limit: int = 5) -> list[str]:
    clean = re.sub(r"[*_`#>\[\]()]", " ", str(text or ""))
    clean = re.sub(r"\s+", " ", clean).strip().lower()
    found: list[str] = []
    seen: set[str] = set()
    known_brands = {
        "nike", "hoka", "adidas", "brooks", "altra", "saucony",
        "asics", "new", "mizuno", "salomon", "on", "puma", "reebok",
        "newton", "topo", "craft", "karhu", "norda", "lululemon", "under",
    }

    def add_model(candidate: Optional[str]):
        if not candidate:
            return
        normalized = _normalize_model_name(candidate).strip(" :.-")
        if not normalized:
            return
        entry = _catalog_entry_by_model(normalized)
        if not entry:
            tokens = _slug_tokens(normalized)
            if len(tokens) < 2 or not (tokens & known_brands):
                return
            return
        resolved = _normalize_model_name(entry["model"])
        key = resolved.lower()
        if not resolved or key in seen:
            return
        seen.add(key)
        found.append(resolved)

    for raw in extract_shoe_models_from_text(text):
        add_model(raw)
        if len(found) >= limit:
            return found[:limit]

    for bold_match in re.findall(r"\*\*(.+?)\*\*", str(text or "")):
        add_model(bold_match)
        if len(found) >= limit:
            return found[:limit]

    if not clean:
        return found[:limit]

    catalog_matches: list[tuple[int, float, str]] = []
    for item in _load_shoe_catalog():
        if not isinstance(item, dict):
            continue
        summary = _catalog_summary(item)
        model = summary.get("model") or ""
        lower_model = model.lower()
        if not model or lower_model not in clean:
            continue
        catalog_matches.append((clean.index(lower_model), -(summary.get("score") or 0), model))

    for _, _, model in sorted(catalog_matches):
        add_model(model)
        if len(found) >= limit:
            break

    return found[:limit]

def _should_fetch_buy_links(message: str) -> bool:
    text = str(message or "").lower()
    if not text:
        return False

    recommendation_keywords = (
        "recommend", "recommendation", "what shoes should", "what shoe should",
        "which shoes should", "which shoe should", "best shoes for", "best shoe for",
        "looking for a shoe", "looking for shoes", "suggest a shoe", "suggest shoes",
        "shoe recommendations", "shoe recommendation",
    )
    replacement_keywords = (
        "replace", "replacement", "replacement for", "retire", "retirement",
        "swap out", "replace my", "replace these", "replace this shoe",
    )
    rotation_phrases = (
        "current rotation", "shoe rotation", "my rotation", "rotation right now",
        "complement my rotation", "round out my rotation", "current shoe rotation",
    )

    has_recommendation_intent = any(keyword in text for keyword in recommendation_keywords)
    has_replacement_intent = any(keyword in text for keyword in replacement_keywords)
    has_rotation_intent = any(phrase in text for phrase in rotation_phrases)

    return has_recommendation_intent or has_replacement_intent or has_rotation_intent

def _athlete_context_citations(athlete_context: Optional[dict], training_data: Optional[dict] = None) -> list[dict[str, Any]]:
    athlete_context = athlete_context if isinstance(athlete_context, dict) else {}
    training_data = training_data if isinstance(training_data, dict) else {}
    citations: list[dict[str, Any]] = []
    strava = athlete_context.get("strava") if isinstance(athlete_context.get("strava"), dict) else {}
    garmin = athlete_context.get("garmin") if isinstance(athlete_context.get("garmin"), dict) else {}
    shoes = strava.get("shoes") if isinstance(strava.get("shoes"), list) else []
    runs = garmin.get("recent_runs") if isinstance(garmin.get("recent_runs"), list) else []
    workouts = training_data.get("scheduled_workouts") if isinstance(training_data.get("scheduled_workouts"), list) else []
    if shoes:
        citations.append({
            "kind": "athlete",
            "label": "Strava shoe mileage",
            "detail": f"{len(shoes)} shoes from connected Strava athlete profile.",
            "url": None,
        })
    if runs:
        citations.append({
            "kind": "athlete",
            "label": "Garmin recent runs",
            "detail": f"{len(runs)} recent runs from connected Garmin account.",
            "url": None,
        })
    if workouts:
        citations.append({
            "kind": "athlete",
            "label": "Garmin scheduled workouts",
            "detail": f"{len(workouts)} upcoming workouts from Garmin training data.",
            "url": None,
        })
    return citations

def _normalize_scheduled_workout(item: dict[str, Any], fallback_date: Optional[str] = None):
    lower_keys = {str(k).lower() for k in item.keys()}
    marker_blob = " ".join(
        str(v).lower() for v in [
            item.get("eventType"),
            item.get("eventTypeKey"),
            item.get("type"),
            item.get("typeKey"),
            item.get("itemType"),
            item.get("eventLabel"),
            item.get("entityType"),
            item.get("sourceType"),
        ] if v not in (None, "")
    )
    has_workout_marker = (
        any("workout" in k for k in lower_keys)
        or any(k in lower_keys for k in {
            "scheduleddate", "scheduled_date", "scheduledworkoutid",
            "workoutid", "workoutname", "estimateddistanceinmeters",
            "estimateddurationinsecs",
        })
        or item.get("workout") not in (None, "", [], {})
        or "workout" in marker_blob
    )
    if not has_workout_marker:
        return None

    scheduled_date = (
        _to_date_str(_pick_nested(
            item,
            ("scheduledDate",),
            ("scheduled_date",),
            ("date",),
            ("calendarDate",),
            ("startDate",),
            ("startTimeLocal",),
            ("displayDate",),
            ("workout", "scheduledDate"),
            ("workout", "calendarDate"),
            ("metadata", "calendarDate"),
        ))
        or fallback_date
    )

    name = _pick_nested(
        item,
        ("workoutName",),
        ("title",),
        ("name",),
        ("eventName",),
        ("displayName",),
        ("summary",),
        ("workout", "workoutName"),
        ("workout", "title"),
        ("workout", "name"),
    )
    workout_id = _pick_nested(
        item,
        ("workoutId",),
        ("scheduledWorkoutId",),
        ("id",),
        ("eventId",),
        ("workout", "workoutId"),
        ("workout", "scheduledWorkoutId"),
    )
    if not scheduled_date and not workout_id:
        return None
    if not name and not workout_id:
        return None

    sport = _normalize_sport(_pick_nested(
        item,
        ("sportType",),
        ("activityType",),
        ("type",),
        ("workout", "sportType"),
    ))
    duration_s = _maybe_num(_pick_nested(
        item,
        ("estimatedDurationInSecs",),
        ("durationInSeconds",),
        ("duration",),
        ("estimatedDuration",),
        ("workout", "estimatedDurationInSecs"),
        ("workout", "duration"),
    ), int)
    distance_m = _maybe_num(_pick_nested(
        item,
        ("estimatedDistanceInMeters",),
        ("distanceInMeters",),
        ("distance",),
        ("estimatedDistance",),
        ("workout", "estimatedDistanceInMeters"),
        ("workout", "distance"),
    ), float)
    description = _pick_nested(
        item,
        ("description",),
        ("note",),
        ("workoutDescription",),
        ("workout", "description"),
        ("workout", "workoutDescription"),
    ) or ""

    return {
        "name": name or "Workout",
        "sport": sport,
        "scheduled_date": scheduled_date or "",
        "estimated_duration_s": duration_s,
        "estimated_distance_m": distance_m,
        "description": description,
        "workout_id": workout_id,
    }

def _dedupe_sort_scheduled(workouts: list[dict[str, Any]]) -> list[dict[str, Any]]:
    deduped = {}
    for workout in workouts:
        key = (
            workout.get("scheduled_date") or "",
            str(workout.get("workout_id") or ""),
            (workout.get("name") or "").strip().lower(),
        )
        prev = deduped.get(key)
        if not prev:
            deduped[key] = workout
            continue
        if (prev.get("estimated_distance_m") or 0) == 0 and (workout.get("estimated_distance_m") or 0):
            deduped[key] = workout
        elif (prev.get("estimated_duration_s") or 0) == 0 and (workout.get("estimated_duration_s") or 0):
            deduped[key] = workout
        elif len(prev.get("description") or "") < len(workout.get("description") or ""):
            deduped[key] = workout
    return sorted(deduped.values(), key=lambda w: (w.get("scheduled_date") or "9999-12-31", w.get("name") or ""))

def _extract_scheduled_workouts(raw: Any, fallback_date: Optional[str] = None) -> list[dict[str, Any]]:
    scheduled = []
    for node in _walk_nodes(raw):
        workout = _normalize_scheduled_workout(node, fallback_date=fallback_date)
        if workout:
            scheduled.append(workout)
    return _dedupe_sort_scheduled(scheduled)

def _connectapi_silent(gc, path: str, **kwargs: Any):
    """Call Garmin connectapi without the library's noisy exception logging."""
    try:
        return gc.garth.connectapi(path, **kwargs)
    except Exception:
        return None

def _fetch_scheduled_workouts(gc, start_day: date, end_day: date, plan_ids: list[int | str]) -> list[dict[str, Any]]:
    start_str, end_str = start_day.isoformat(), end_day.isoformat()

    # Daily events are much closer to the Garmin Connect calendar and include
    # coach / planned sessions for many accounts. Prefer this first because the
    # legacy workout-service/schedule endpoint is currently returning 404.
    from_events = []
    cursor = start_day
    while cursor <= end_day:
        iso = cursor.isoformat()
        try:
            raw = gc.get_all_day_events(iso)
            from_events.extend(_extract_scheduled_workouts(raw, fallback_date=iso))
        except Exception:
            pass
        cursor += timedelta(days=1)
    # Fall back to plan details for Garmin Coach / adaptive plans when available.
    # Probe adaptive first, then phased, and do it silently because Garmin often
    # returns 400 on the wrong variant even for valid plan IDs.
    from_plans = []
    for plan_id in [pid for pid in plan_ids if pid]:
        for path in (
            f"{gc.garmin_connect_training_plan_url}/fbt-adaptive/{plan_id}",
            f"{gc.garmin_connect_training_plan_url}/phased/{plan_id}",
        ):
            raw = _connectapi_silent(gc, path)
            if raw:
                from_plans.extend(_extract_scheduled_workouts(raw))
                break
    # Last resort: silently probe the legacy schedule endpoint variants.
    from_legacy = []
    for params in (
        {"startDate": start_str, "endDate": end_str},
        {"fromDate": start_str, "toDate": end_str},
        {"start": 0, "limit": 100},
        None,
    ):
        raw = _connectapi_silent(gc, gc.garmin_workouts_schedule_url, params=params) if params else _connectapi_silent(gc, gc.garmin_workouts_schedule_url)
        if raw:
            scheduled = _extract_scheduled_workouts(raw)
            if scheduled:
                from_legacy.extend(scheduled)
                break

    return _dedupe_sort_scheduled(from_events + from_plans + from_legacy)

class PinBody(BaseModel):
    pin: str

@app.get("/auth/status")
async def auth_status():
    return {"pin_set": _pin_hash is not None}

@app.post("/auth/setup")
async def auth_setup(b: PinBody, request: Request):
    global _pin_hash, _session_tok
    if _pin_hash: raise HTTPException(400,"PIN already set")
    if len(b.pin)<4: raise HTTPException(400,"PIN must be ≥ 4 characters")
    _pin_hash=_hp(b.pin); _session_tok=secrets.token_hex(32); _capture(request)
    return {"token":_session_tok}

@app.post("/auth/login")
async def auth_login(b: PinBody, request: Request):
    global _session_tok
    if not _pin_hash: raise HTTPException(400,"PIN not set")
    if _hp(b.pin)!=_pin_hash: raise HTTPException(401,"Incorrect PIN")
    _session_tok=secrets.token_hex(32); _capture(request)
    return {"token":_session_tok}

@app.post("/auth/logout")
async def auth_logout(x_session_token: Optional[str]=Header(default=None)):
    global _session_tok; _session_tok=None; return {"ok":True}

_coll=None
def get_coll():
    global _coll
    if _coll: return _coll
    api_key = os.environ.get("OPENAI_API_KEY", "").strip()
    if not api_key:
        raise RuntimeError("OPENAI_API_KEY not set for embedding search")
    from chromadb.utils import embedding_functions as e
    ef=e.OpenAIEmbeddingFunction(api_key=api_key,
                                  model_name="text-embedding-3-large")
    _coll=chromadb.PersistentClient(path=CHROMA_DIR).get_collection(name=COLLECTION,embedding_function=ef)
    return _coll


def _fallback_catalog_context(query: str, limit: int = N_RESULTS) -> tuple[str, list[dict[str, Any]]]:
    matches = _search_catalog(query, limit=limit)
    if not matches:
        return "No shoes in database.", []

    lines: list[str] = []
    citations: list[dict[str, Any]] = []
    for summary in matches:
        traits = []
        if summary.get("support"):
            traits.append(f"support:{summary['support']}")
        if summary.get("weight_oz") is not None:
            traits.append(f"weight:{summary['weight_oz']}oz")
        if summary.get("drop_mm") is not None:
            traits.append(f"drop:{summary['drop_mm']}mm")
        if summary.get("usage_tags"):
            traits.append(f"usage:{', '.join(summary['usage_tags'])}")
        pros = "; ".join(summary.get("pros") or [])
        cons = "; ".join(summary.get("cons") or [])
        lines.append(f"--- {summary.get('model', '?')} (catalog fallback) ---")
        if traits:
            lines.append(" | ".join(traits))
        if pros:
            lines.append(f"Pros: {pros}")
        if cons:
            lines.append(f"Cons: {cons}")
        lines.append("")
        citations.append({
            "kind": "shoe_db",
            "label": summary.get("model") or "Catalog match",
            "detail": "RunRepeat catalog match from local fallback search.",
            "url": summary.get("url") or None,
        })
    return "\n".join(lines).strip(), citations

def retrieve_context(q: str) -> tuple[str, list[dict[str, Any]]]:
    try:
        c=get_coll(); n=min(N_RESULTS,c.count())
        if n==0:
            return "No shoes in database.", []
        r=c.query(query_texts=[q],n_results=n,include=["documents","metadatas","distances"])
        lines=[]; citations=[]
        for doc,meta,dist in zip(r["documents"][0],r["metadatas"][0],r["distances"][0]):
            lines+=[f"--- {meta.get('model','?')} (relevance:{round(1-dist,3)}) ---",doc,""]
            citations.append({
                "kind": "shoe_db",
                "label": meta.get("model") or "Catalog match",
                "detail": f"RunRepeat catalog match with relevance {round(1-dist, 3)}.",
                "url": meta.get("url") or None,
            })
        return "\n".join(lines), citations
    except Exception as e:
        fallback_text, fallback_citations = _fallback_catalog_context(q)
        if fallback_citations:
            return fallback_text, fallback_citations
        return f"[Shoe DB: {e}]", [{
            "kind": "system",
            "label": "Shoe database",
            "detail": str(e),
            "url": None,
        }]

class StravaCreds(BaseModel):
    client_id: str; client_secret: str

@app.post("/strava/set-credentials")
async def strava_set_creds(b: StravaCreds, request: Request,
                            x_session_token: Optional[str]=Header(default=None)):
    _auth(x_session_token)
    global _strava_id,_strava_sec
    _strava_id=b.client_id.strip(); _strava_sec=b.client_secret.strip(); _capture(request)
    return {"ok":True}

@app.get("/strava/auth")
async def strava_auth():
    if not _strava_id: raise HTTPException(400,"Strava credentials not set")
    return RedirectResponse(f"https://www.strava.com/oauth/authorize?client_id={_strava_id}"
        f"&response_type=code&redirect_uri=http://localhost:8000/strava/callback"
        f"&approval_prompt=auto&scope=read,activity:read_all,profile:read_all")

@app.get("/strava/callback")
async def strava_callback(code: str=Query(...)):
    if not _strava_id or not _strava_sec: raise HTTPException(400,"Strava not configured")
    async with httpx.AsyncClient() as c:
        r=await c.post("https://www.strava.com/oauth/token",data={
            "client_id":_strava_id,"client_secret":_strava_sec,
            "code":code,"grant_type":"authorization_code"})
        r.raise_for_status(); d=r.json()
    params=urllib.parse.urlencode({"access_token":d["access_token"],
        "refresh_token":d["refresh_token"],"expires_at":d["expires_at"]})
    fe=_frontend_origin or "http://localhost:5173"
    return RedirectResponse(f"{fe}?strava_tokens={urllib.parse.quote(params)}")

class StravaRefresh(BaseModel):
    refresh_token: str

@app.post("/strava/refresh")
async def strava_refresh(b: StravaRefresh,
                          x_session_token: Optional[str]=Header(default=None)):
    _auth(x_session_token)
    if not _strava_id: raise HTTPException(400,"Strava not configured")
    async with httpx.AsyncClient() as c:
        r=await c.post("https://www.strava.com/oauth/token",data={
            "client_id":_strava_id,"client_secret":_strava_sec,
            "refresh_token":b.refresh_token,"grant_type":"refresh_token"})
        r.raise_for_status(); d=r.json()
    return {"access_token":d["access_token"],"refresh_token":d["refresh_token"],"expires_at":d["expires_at"]}

class StravaFetch(BaseModel):
    access_token: str; refresh_token: str; expires_at: float  # stored as float in localStorage

@app.post("/strava/fetch-data")
async def strava_fetch(b: StravaFetch,
                        x_session_token: Optional[str]=Header(default=None)):
    _auth(x_session_token)
    if not _strava_id or not _strava_sec:
        raise HTTPException(400,"Strava credentials not set — re-enter Client ID and Secret in the Connect tab")
    tok=b.access_token
    if b.expires_at < datetime.utcnow().timestamp() + 60:
        nr=await strava_refresh(StravaRefresh(refresh_token=b.refresh_token),
                                 x_session_token=x_session_token)
        tok=nr["access_token"]
    hdrs={"Authorization":f"Bearer {tok}"}
    async with httpx.AsyncClient(timeout=30) as c:
        # Athlete profile — shoes
        ar = await c.get(f"{STRAVA_BASE}/athlete", headers=hdrs)
        ar.raise_for_status()
        athlete = ar.json()

        # Recent activities — last 90 days, paginate through the full result set.
        since_ts = int((datetime.utcnow() - timedelta(days=90)).timestamp())
        acts_raw = await _fetch_strava_activities(c, hdrs, since_ts)
        runs = [
            {
                "name":               a.get("name", "Run"),
                "type":               "Run",
                "start_time":         a.get("start_date_local"),
                "activity_id":        a.get("id"),
                "distance":           float(a.get("distance") or 0),
                "duration_in_seconds":float(a.get("moving_time") or 0),
                "average_heartrate":  a.get("average_heartrate"),
                "max_heartrate":      a.get("max_heartrate"),
                "average_cadence":    (a.get("average_cadence") or 0) * 2 or None,
                "elevation_gain":     a.get("total_elevation_gain"),
                "avg_power":          a.get("average_watts"),
                "training_effect":    None,
                "training_effect_label": None,
            }
            for a in acts_raw
            if str(a.get("type", "")).lower() in ("run", "virtualrun", "trailrun")
        ]

        # Weekly mileage trend from Strava activities
        weekly_trend = _build_weekly_trend_from_runs(
            runs,
            date_field="start_time",
            distance_field="distance",
            count=12,
            today_dt=date.today(),
        )

    return {
        "shoes":        athlete.get("shoes", []),
        "recent_runs":  runs[:30],
        "weekly_trend": weekly_trend,
    }

class GarminLogin(BaseModel):
    email: str; password: str

@app.post("/garmin/login")
async def garmin_login(b: GarminLogin,
                        x_session_token: Optional[str]=Header(default=None)):
    _auth(x_session_token)
    global _garmin_cli, _garmin_email

    try:
        from garminconnect import Garmin
    except ModuleNotFoundError as e:
        raise HTTPException(500, "Missing garminconnect") from e

    gc = Garmin(b.email.strip(), b.password)
    os.makedirs(GARMIN_TOKEN_DIR, exist_ok=True)

    # -----------------------------------------------------------------------
    # Step 1: Try to restore cached garth tokens and validate them with a
    # lightweight API call — skipping SSO entirely if they're still good.
    # This is the primary path and avoids the 429 rate limit on Garmin's
    # auth endpoint.
    # -----------------------------------------------------------------------
    token_file = os.path.join(GARMIN_TOKEN_DIR, "oauth2_token.json")
    if os.path.exists(token_file):
        try:
            gc.garth.loads(GARMIN_TOKEN_DIR)
            # Validate with a cheap call — raises if tokens are expired
            await asyncio.to_thread(
                gc.connectapi, "/userprofile-service/userprofile/personal-information"
            )
            print(f"[Garmin] Cached tokens are valid — skipped SSO login")
            _garmin_cli = gc
            _garmin_email = b.email.strip()
            return {"ok": True, "email": _garmin_email, "source": "cached_tokens"}
        except Exception as cache_err:
            print(f"[Garmin] Cached tokens invalid ({cache_err}), falling through to SSO login")

    # -----------------------------------------------------------------------
    # Step 2: No valid cached tokens — attempt a full SSO login.
    # Garmin aggressively rate-limits this endpoint (429) if called too often.
    # If you're hitting 429 repeatedly, use POST /garmin/set-tokens to inject
    # tokens manually instead of going through SSO.
    # -----------------------------------------------------------------------
    try:
        await asyncio.to_thread(gc.login)
    except Exception as e:
        msg = str(e)
        if "429" in msg or "Too Many Requests" in msg:
            raise HTTPException(
                429,
                "Garmin has rate-limited this IP due to repeated login attempts. "
                "You may need to wait 24–48 hours before SSO will work again. "
                "Use POST /garmin/set-tokens to inject tokens manually in the meantime — "
                "see the endpoint docs for how to extract them from your browser."
            )
        raise HTTPException(401, f"Garmin login failed: {msg}")

    # Persist tokens so the next call skips SSO
    try:
        gc.garth.dump(GARMIN_TOKEN_DIR)
        print(f"[Garmin] Saved fresh tokens to {GARMIN_TOKEN_DIR}")
    except Exception as e:
        print(f"[Garmin] WARNING: could not save tokens: {e}")

    _garmin_cli = gc
    _garmin_email = b.email.strip()
    return {"ok": True, "email": _garmin_email, "source": "sso_login"}


class GarminTokens(BaseModel):
    """
    Manual token injection — use this when Garmin's SSO is rate-limiting you.

    How to get your tokens without SSO:
      1. Log in to connect.garmin.com in your browser.
      2. Open DevTools → Application → Cookies → sso.garmin.com
      3. Copy the value of 'JWT_FT' (oauth1 token) and 'GARMIN-SSO-CUST-TOKEN' (oauth2 token).
         Alternatively, go to DevTools → Network, filter for 'connect.garmin.com/modern/proxy',
         and copy the 'Authorization: Bearer <token>' header value from any request.
      4. POST both values here. They are written to ~/.garth and reused on every
         subsequent /garmin/login call — no SSO needed until they expire (~30 days).
    """
    email: str
    oauth1_token: Optional[str] = None   # JWT_FT cookie value
    oauth2_token: str                     # Bearer token / GARMIN-SSO-CUST-TOKEN


@app.post("/garmin/set-tokens")
async def garmin_set_tokens(b: GarminTokens,
                             x_session_token: Optional[str]=Header(default=None)):
    """
    Inject Garmin OAuth tokens manually to bypass SSO rate-limiting.
    Tokens are saved to ~/.garth so /garmin/login will reuse them automatically.
    """
    _auth(x_session_token)
    global _garmin_cli, _garmin_email

    try:
        from garminconnect import Garmin
        import garth
    except ModuleNotFoundError as e:
        raise HTTPException(500, "Missing garminconnect / garth") from e

    os.makedirs(GARMIN_TOKEN_DIR, exist_ok=True)

    gc = Garmin(b.email.strip(), "")

    # Garth validates JWT structure when loading from file. To bypass this,
    # set the token directly on the garth client object instead of writing
    # a file and calling loads(). We write the file afterward for persistence.
    try:
        from garth.auth_tokens import OAuth2Token
        raw = b.oauth2_token.strip()
        token_obj = OAuth2Token({
            "scope": "",
            "jti": "manual",
            "token_type": "Bearer",
            "access_token": raw,
            "refresh_token": raw,
            "expires_in": 3600,
            "expires_at": 9999999999,
        })
        gc.garth.oauth2_token = token_obj
        print(f"[Garmin] Injected token directly into garth client")
    except Exception as e:
        # Fallback: write a minimal token file
        import json as _json
        token_file = os.path.join(GARMIN_TOKEN_DIR, "oauth2_token.json")
        token_data = {
            "scope": "", "jti": "manual", "token_type": "Bearer",
            "access_token": b.oauth2_token.strip(),
            "refresh_token": b.oauth2_token.strip(),
            "expires_in": 3600, "expires_at": 9999999999,
        }
        try:
            with open(token_file, "w") as f:
                _json.dump(token_data, f)
        except Exception as write_err:
            raise HTTPException(500, f"Could not write token file: {write_err}")
        try:
            gc.garth.loads(GARMIN_TOKEN_DIR)
        except Exception as load_err:
            raise HTTPException(500, f"garth could not load written tokens: {load_err}")

    # Validate with a lightweight call
    try:
        await asyncio.to_thread(
            gc.connectapi, "/userprofile-service/userprofile/personal-information"
        )
    except Exception as e:
        raise HTTPException(401, f"Token validation failed — token may be expired or invalid: {e}")

    _garmin_cli = gc
    _garmin_email = b.email.strip()
    return {"ok": True, "email": _garmin_email, "message": "Tokens accepted and saved."}

@app.post("/garmin/logout")
async def garmin_logout(x_session_token: Optional[str]=Header(default=None)):
    _auth(x_session_token)
    global _garmin_cli,_garmin_email; _garmin_cli=None; _garmin_email=None; return {"ok":True}

@app.get("/garmin/status")
async def garmin_status(x_session_token: Optional[str]=Header(default=None)):
    _auth(x_session_token); return {"connected":_garmin_cli is not None,"email":_garmin_email}

@app.get("/garmin/fetch-data")
async def garmin_fetch(x_session_token: Optional[str]=Header(default=None)):
    _auth(x_session_token)

    if not _garmin_cli:
        raise HTTPException(401, "Not logged in to Garmin")

    gc = _garmin_cli
    today = date.today()
    td = today.isoformat()
    s30 = (today - timedelta(days=30)).isoformat()
    s90 = (today - timedelta(days=90)).isoformat()

    out = {}

    # =========================
    # PARALLEL CORE CALLS
    # =========================
    results = await asyncio.gather(
        garmin_call(gc.get_activities_by_date, s30, td, "running"),
        garmin_call(gc.get_activities_by_date, s90, td, "running"),
        garmin_call(gc.get_stats, td),
        garmin_call(gc.get_training_status, td),
        garmin_call(gc.get_body_battery, s30, td),
        garmin_call(gc.get_hrv_data, td),
        garmin_call(gc.get_race_predictions),
        garmin_call(gc.get_personal_record),
        return_exceptions=True
    )

    acts, acts90, stats, tr, bb, hrv_raw, rp, pr_raw = results

    # =========================
    # RECENT RUNS
    # =========================
    out["recent_runs"] = [{
        "name": a.get("activityName", "Run"),
        "type": "Run",
        "start_time": a.get("startTimeLocal"),
        "activity_id": a.get("activityId"),
        "distance": float(a.get("distance") or 0),
        "duration_in_seconds": float(a.get("duration") or 0),
        "average_heartrate": a.get("averageHR"),
        "max_heartrate": a.get("maxHR"),
        "average_cadence": a.get("averageRunningCadenceInStepsPerMinute"),
        "training_effect": a.get("aerobicTrainingEffect"),
        "training_effect_label": a.get("aerobicTrainingEffectMessage"),
        "elevation_gain": a.get("elevationGain"),
        "avg_power": a.get("avgPower"),
    } for a in (acts or [])[:30]]

    # =========================
    # WEEKLY TREND
    # =========================
    out["weekly_trend"] = _build_weekly_trend_from_runs(
        acts90 if isinstance(acts90, list) else [],
        date_field="startTimeLocal",
        distance_field="distance",
        count=12,
        today_dt=date.today(),
    )

    # =========================
    # STATS
    # =========================
    if stats:
        out["resting_hr"] = stats.get("restingHeartRate") or stats.get("minAvgHeartRate")
        out["total_steps"] = stats.get("totalSteps")
        out["active_calories"] = stats.get("activeKilocalories")

    # =========================
    # TRAINING STATUS
    # =========================
    if isinstance(tr, dict):
        generic = (tr.get("mostRecentVO2Max") or {}).get("generic") or {}
        out["vo2max"] = generic.get("vo2MaxPreciseValue") or generic.get("vo2MaxValue")

        ts_map = ((tr.get("mostRecentTrainingStatus") or {})
                  .get("latestTrainingStatusData") or {})
        ts = next(iter(ts_map.values()), {}) if ts_map else {}

        out["training_status_phrase"] = (
            (ts.get("trainingStatusFeedbackPhrase") or "")
            .replace("TRAINING_STATUS_", "")
            .replace("_", " ")
            .lower()
            .capitalize()
        )

        acwl = ts.get("acuteTrainingLoadDTO") or {}
        out["training_load"] = acwl.get("dailyTrainingLoadAcute")
        out["chronic_load"] = acwl.get("dailyTrainingLoadChronic")

    # =========================
    # BODY BATTERY
    # =========================
    if bb:
        out["body_battery"] = [{
            "date": (entry.get("date") or entry.get("calendarDate")),
            "end_level": entry.get("endLevel"),
            "charged": entry.get("charged"),
            "drained": entry.get("drained"),
        } for entry in (bb or [])][-14:]

    # =========================
    # HRV
    # =========================
    if isinstance(hrv_raw, dict):
        summary = hrv_raw.get("hrvSummary") or {}
        out["hrv"] = summary.get("weeklyAvg") or summary.get("lastNightAvg")
        out["hrv_status"] = (summary.get("status") or "").replace("_", " ").lower().capitalize()
        out["hrv_baseline_low"] = (summary.get("baseline") or {}).get("balancedLow")
        out["hrv_baseline_high"] = (summary.get("baseline") or {}).get("balancedUpper")

    # =========================
    # RACE PREDICTIONS
    # =========================
    if isinstance(rp, dict):
        out["race_predictions"] = [
            {"distance": k, "time_seconds": v}
            for k, v in rp.items() if v
        ]

    # =========================
    # PERSONAL RECORDS
    # =========================
    out["personal_records"] = pr_raw or []

    # =========================
    # ASYNC LOOP: SLEEP
    # =========================
    sleep_tasks = [
        garmin_call(gc.get_sleep_data, (today - timedelta(days=i)).isoformat())
        for i in range(14)
    ]

    sleep_results = await asyncio.gather(*sleep_tasks)

    sleep_list = []
    for i, sl in enumerate(sleep_results):
        d = (today - timedelta(days=i)).isoformat()
        if sl and sl.get("dailySleepDTO"):
            dto = sl["dailySleepDTO"]
            sleep_list.append({
                "date": d,
                "duration_s": dto.get("sleepTimeSeconds"),
                "deep_s": dto.get("deepSleepSeconds"),
                "light_s": dto.get("lightSleepSeconds"),
                "rem_s": dto.get("remSleepSeconds"),
                "awake_s": dto.get("awakeSleepSeconds"),
                "score": dto.get("sleepScores", {}).get("overall", {}).get("value"),
            })

    out["sleep"] = list(reversed(sleep_list))

    # =========================
    # ASYNC LOOP: STRESS
    # =========================
    stress_tasks = [
        garmin_call(gc.get_stress_data, (today - timedelta(days=i)).isoformat())
        for i in range(14)
    ]

    stress_results = await asyncio.gather(*stress_tasks)

    stress_list = []
    for i, st in enumerate(stress_results):
        d = (today - timedelta(days=i)).isoformat()
        if st:
            stress_list.append({
                "date": d,
                "avg_stress": st.get("overallStressLevel") or st.get("avgStressLevel")
            })

    out["stress"] = list(reversed(stress_list))

    # =========================
    # ASYNC LOOP: RESTING HR
    # =========================
    rhr_tasks = [
        garmin_call(gc.get_rhr_day, (today - timedelta(days=i)).isoformat())
        for i in range(14)
    ]

    rhr_results = await asyncio.gather(*rhr_tasks)

    resting_hr_trend = []
    for i, rhr_payload in enumerate(rhr_results):
        d = (today - timedelta(days=i)).isoformat()
        resting_value = _extract_resting_hr(rhr_payload)
        if resting_value is not None:
            resting_hr_trend.append({
                "date": d,
                "resting_hr": resting_value,
            })

    out["resting_hr_trend"] = list(reversed(resting_hr_trend))

    # =========================
    # ASYNC LOOP: TRAINING READINESS
    # =========================
    readiness_tasks = [
        garmin_call(gc.get_training_readiness, (today - timedelta(days=i)).isoformat())
        for i in range(14)
    ]

    readiness_results = await asyncio.gather(*readiness_tasks)

    readiness = []
    for i, tr in enumerate(readiness_results):
        d = (today - timedelta(days=i)).isoformat()
        if not tr:
            continue

        entry = tr[0] if isinstance(tr, list) else tr
        score = entry.get("score") or entry.get("trainingReadiness")

        if score:
            readiness.append({
                "date": d,
                "score": int(score),
                "feedback": (entry.get("feedbackPhrase") or "").replace("_", " ").lower()
            })

    out["readiness_trend"] = list(reversed(readiness))

    return out

@app.get("/garmin/training")
async def garmin_training(x_session_token: Optional[str]=Header(default=None)):
    _auth(x_session_token)
    if not _garmin_cli: raise HTTPException(401,"Not logged in to Garmin")
    today=date.today(); td=today.isoformat()
    def _sync():
        gc=_garmin_cli; out={}
        try:
            plans_resp = gc.get_training_plans()
            # Response shape (confirmed): {
            #   trainingPlanList: [{
            #     trainingPlanId, name, description, durationInWeeks, avgWeeklyWorkouts,
            #     startDate, endDate,
            #     trainingStatus: { statusId, statusKey },   e.g. "Scheduled"
            #     trainingType: { typeKey },                 e.g. "Running"
            #     trainingLevel: { levelKey },               e.g. "Intermediate"
            #   }]
            # }
            plan_list = []
            if isinstance(plans_resp, dict):
                plan_list = plans_resp.get("trainingPlanList") or []
            elif isinstance(plans_resp, list):
                plan_list = plans_resp

            from datetime import date as _date
            today_d = _date.today()

            def _current_week(start_str):
                """Calculate which week of the plan today falls in."""
                if not start_str: return None
                try:
                    start = _date.fromisoformat(start_str[:10])
                    delta = (today_d - start).days
                    return max(1, delta // 7 + 1) if delta >= 0 else None
                except Exception: return None

            out["training_plans"] = [{
                "name":             p.get("name") or "Unknown Plan",
                "description":      p.get("description") or "",
                "target_race_date": p.get("endDate","")[:10],
                "start_date":       p.get("startDate","")[:10],
                "total_weeks":      p.get("durationInWeeks"),
                "current_week":     _current_week(p.get("startDate","")),
                "weekly_days":      p.get("avgWeeklyWorkouts"),
                "weekly_km":        None,   # not provided; backfilled from scheduled workouts below
                "status":           (p.get("trainingStatus") or {}).get("statusKey",""),
                "plan_id":          p.get("trainingPlanId"),
                "race_distance":    (p.get("trainingType") or {}).get("typeKey",""),
                "level":            (p.get("trainingLevel") or {}).get("levelKey",""),
            } for p in plan_list if p]
        except Exception as e: print(f"plans:{e}"); out["training_plans"]=[]
        try:
            start_window = today - timedelta(days=7)
            end_window = today + timedelta(days=28)
            plan_ids = [p.get("plan_id") for p in out.get("training_plans", []) if isinstance(p, dict)]
            out["scheduled_workouts"] = _fetch_scheduled_workouts(gc, start_window, end_window, plan_ids)
        except Exception as e: print(f"scheduled:{e}"); out["scheduled_workouts"]=[]
        try:
            goals=gc.get_goals(); out["goals"]=goals if isinstance(goals,list) else []
        except Exception as e: print(f"goals:{e}"); out["goals"]=[]
        try:
            rt=[]
            for i in range(14):
                d=(today-timedelta(days=i)).isoformat()
                try:
                    tr=gc.get_training_readiness(d)
                    if not tr: continue
                    # May be list or dict
                    entry = tr[0] if isinstance(tr, list) else tr
                    score = entry.get("score") or entry.get("trainingReadiness") or entry.get("level")
                    fb = (entry.get("feedbackShort") or entry.get("feedbackLong") or
                          entry.get("feedbackPhrase") or "").replace("_"," ").lower()
                    if score: rt.append({"date":d,"score":int(score),"feedback":fb})
                except Exception: pass
            out["readiness_trend"]=list(reversed(rt))
        except Exception as e: print(f"readiness:{e}")
        return out
    return await asyncio.get_event_loop().run_in_executor(None,_sync)


@app.get("/garmin/debug")
async def garmin_debug(x_session_token: Optional[str]=Header(default=None)):
    """Dump raw Garmin API responses to help diagnose field names."""
    _auth(x_session_token)
    if not _garmin_cli: raise HTTPException(401,"Not logged in to Garmin")
    today=date.today(); td=today.isoformat()
    def _sync():
        gc=_garmin_cli; out={}
        for name, fn, args in [
            ("stats", gc.get_stats, [td]),
            ("max_metrics", gc.get_max_metrics, [td]),
            ("hrv", gc.get_hrv_data, [td]),
            ("training_status", gc.get_training_status, [td]),
            ("training_readiness", gc.get_training_readiness, [td]),
            ("race_predictions", gc.get_race_predictions, []),
            ("personal_record", gc.get_personal_record, []),
            ("training_plans", gc.get_training_plans, []),
            ("today_events", gc.get_all_day_events, [td]),
            ("workouts_library", gc.get_workouts, []),
        ]:
            try: out[name]=fn(*args)
            except Exception as e: out[name]=f"ERROR: {e}"
        return out
    return await asyncio.get_event_loop().run_in_executor(None, _sync)

# ===========================================================================
# INTERVALS.ICU INTEGRATION
# A drop-in alternative to Garmin that returns data in the same shape.
# Users get their Athlete ID and API key from https://intervals.icu/settings
# under "API Access".
# ===========================================================================

_intervals_athlete_id: Optional[str] = None
_intervals_api_key:    Optional[str] = None

class IntervalsLogin(BaseModel):
    athlete_id: str   # e.g. "i12345"
    api_key:    str

class IntervalsStatus(BaseModel):
    connected:   bool
    athlete_id:  Optional[str] = None

@app.post("/intervals/login")
async def intervals_login(b: IntervalsLogin,
                          x_session_token: Optional[str] = Header(default=None)):
    """Store Intervals.icu credentials and verify they work."""
    _auth(x_session_token)
    global _intervals_athlete_id, _intervals_api_key

    aid = b.athlete_id.strip()
    key = b.api_key.strip()

    async with httpx.AsyncClient(timeout=10) as c:
        r = await c.get(
            f"https://intervals.icu/api/v1/athlete/{aid}",
            auth=("API_KEY", key),
        )
        if r.status_code == 401:
            raise HTTPException(401, "Invalid Intervals.icu athlete ID or API key.")
        if r.status_code != 200:
            raise HTTPException(r.status_code, f"Intervals.icu error: {r.text[:200]}")

    _intervals_athlete_id = aid
    _intervals_api_key    = key
    return {"ok": True, "athlete_id": aid}

@app.get("/intervals/status")
async def intervals_status(x_session_token: Optional[str] = Header(default=None)):
    _auth(x_session_token)
    return {"connected": bool(_intervals_athlete_id), "athlete_id": _intervals_athlete_id}

@app.post("/intervals/logout")
async def intervals_logout(x_session_token: Optional[str] = Header(default=None)):
    _auth(x_session_token)
    global _intervals_athlete_id, _intervals_api_key
    _intervals_athlete_id = None
    _intervals_api_key    = None
    return {"ok": True}

async def _intervals_get(path: str, params: dict = {}) -> Any:
    """Authenticated GET against the Intervals.icu API."""
    async with httpx.AsyncClient(timeout=20) as c:
        r = await c.get(
            f"https://intervals.icu/api/v1/athlete/{_intervals_athlete_id}/{path}",
            auth=("API_KEY", _intervals_api_key),
            params=params,
        )
        if r.status_code != 200:
            print(f"[Intervals] {path} → {r.status_code}: {r.text[:200]}")
            return None
        return r.json()

async def _fetch_intervals_data() -> dict:
    """
    Core data fetcher for Intervals.icu — called by the endpoint and the
    background refresh loop. Returns data in the same shape as /garmin/fetch-data.
    """
    today = date.today()
    td    = today.isoformat()
    s30   = (today - timedelta(days=30)).isoformat()
    s90   = (today - timedelta(days=90)).isoformat()
    s14   = (today - timedelta(days=14)).isoformat()

    # Fetch everything in parallel — activities (90d), wellness (14d), athlete profile
    acts_raw, wellness_raw, athlete_raw = await asyncio.gather(
        _intervals_get("activities", {"oldest": s90, "newest": td, "limit": 200}),
        _intervals_get("wellness",   {"oldest": s14, "newest": td}),
        _intervals_get(""),
    )

    out: dict[str, Any] = {}

    # ── Recent runs (last 30 days) ──────────────────────────────────────────
    runs = [
        a for a in (acts_raw or [])
        if "run" in str(a.get("type", "")).lower()
        and (a.get("start_date_local") or "")[:10] >= s30
    ]
    out["recent_runs"] = [{
        "name":               a.get("name", "Run"),
        "type":               "Run",
        "start_time":         a.get("start_date_local"),
        "activity_id":        a.get("id"),
        "distance":           float(a.get("distance") or 0),
        "duration_in_seconds":float(a.get("moving_time") or a.get("elapsed_time") or 0),
        "average_heartrate":  a.get("average_heartrate"),
        "max_heartrate":      a.get("max_heartrate"),
        "average_cadence":    (a.get("average_cadence") or 0) * 2 or None,
        "training_effect":    None,
        "training_effect_label": None,
        "elevation_gain":     a.get("total_elevation_gain"),
        "avg_power":          a.get("average_watts"),
    } for a in runs[:30]]

    # ── Weekly mileage trend (90 days) ──────────────────────────────────────
    out["weekly_trend"] = _build_weekly_trend_from_runs(
        [
            a for a in (acts_raw or [])
            if "run" in str(a.get("type", "")).lower()
        ],
        date_field="start_date_local",
        distance_field="distance",
        count=12,
        today_dt=date.today(),
    )

    # ── Wellness — HRV, resting HR, sleep, readiness ────────────────────────
    wellness_list = wellness_raw if isinstance(wellness_raw, list) else []
    latest_w = next(
        (w for w in reversed(wellness_list) if w.get("hrv") or w.get("restingHR")),
        {}
    )
    out["resting_hr"]        = latest_w.get("restingHR")
    out["hrv"]               = latest_w.get("hrv")
    out["hrv_status"]        = None
    out["hrv_baseline_low"]  = None
    out["hrv_baseline_high"] = None

    out["sleep"] = [
        {
            "date":       w.get("id"),
            "duration_s": int(w.get("sleepSecs") or 0),
            "deep_s":     None,
            "light_s":    None,
            "rem_s":      None,
            "awake_s":    None,
            "score":      w.get("sleepScore"),
        }
        for w in wellness_list if w.get("sleepSecs") or w.get("sleepScore")
    ]

    out["readiness_trend"] = [
        {
            "date":     w.get("id"),
            "score":    int(w["form"]) if w.get("form") is not None else None,
            "feedback": "form (fitness − fatigue)",
        }
        for w in wellness_list if w.get("form") is not None
    ]

    out["resting_hr_trend"] = [
        {
            "date": w.get("id"),
            "resting_hr": int(w["restingHR"]),
        }
        for w in wellness_list if w.get("restingHR") is not None
    ]

    out["stress"]       = []
    out["body_battery"] = []

    # ── Athlete profile — VO2max, training load ─────────────────────────────
    if isinstance(athlete_raw, dict):
        out["vo2max"]        = athlete_raw.get("vo2max")
        out["training_load"] = athlete_raw.get("atl")
        out["chronic_load"]  = athlete_raw.get("ctl")
        form = athlete_raw.get("form") or 0
        out["training_status_phrase"] = (
            "productive" if form > 5 else
            "maintenance" if form >= -10 else
            "overreaching"
        )
        out["total_steps"]     = None
        out["active_calories"] = None

    out["race_predictions"] = []
    out["personal_records"] = []
    return out


@app.get("/intervals/fetch-data")
async def intervals_fetch(
    force: bool = Query(default=False, description="Bypass cache and fetch fresh data"),
    x_session_token: Optional[str] = Header(default=None),
):
    """
    Return Intervals.icu data in the same shape as /garmin/fetch-data.
    Served from in-memory cache (refreshed every 30min by background task).
    Pass ?force=true to bypass cache.
    """
    _auth(x_session_token)
    if not _intervals_athlete_id:
        raise HTTPException(401, "Not logged in to Intervals.icu")

    global _cached_intervals_data
    if not force and _cached_intervals_data is not None:
        print("[Intervals] Serving from cache")
        return _cached_intervals_data

    data = await _fetch_intervals_data()
    _cached_intervals_data = data
    return data

@app.get("/connection-status")
async def conn_status(x_session_token: Optional[str]=Header(default=None)):
    _auth(x_session_token)
    return {"strava_configured":bool(_strava_id and _strava_sec),
            "garmin":_garmin_cli is not None,"garmin_email":_garmin_email}

def _athlete_ctx(ctx):
    if not ctx: return ""
    lines=["[Athlete Profile]"]; s=ctx.get("strava"); g=ctx.get("garmin")
    if s and s.get("shoes"):
        lines.append("Shoes (Strava):")
        for sh in s["shoes"]:
            dist_mi=(sh.get("distance",0) or 0)/M_PER_MI
            ret_mi=(sh.get("retire_distance",800000) or 800000)/M_PER_MI
            pct=round(dist_mi/ret_mi*100) if ret_mi else 0
            lines.append(f"  {sh.get('name','?')}{'[P]' if sh.get('primary') else ''}: {dist_mi:.1f}/{ret_mi:.1f}mi ({pct}%)")
    if g:
        parts=[]
        for k,lbl in [("vo2max","VO2max"),("resting_hr","RHR"),("training_load","Load"),
                      ("recovery_time","Rec"),("training_readiness","Readiness"),("hrv","HRV"),
                      ("total_steps","Steps"),("endurance_score","Endurance")]:
            if g.get(k): parts.append(f"{lbl}:{g[k]}")
        if parts: lines.append("Garmin: "+" · ".join(parts))
        if g.get("training_status_phrase"): lines.append(f"Status: {g['training_status_phrase']}")
        if g.get("recent_runs"):
            lines.append("Recent runs (Garmin):")
            for r in g["recent_runs"][:8]:
                dist_mi=(r.get("distance",0) or 0)/M_PER_MI
                dur_s=r.get("duration_in_seconds",0) or 0
                pace_s_mi=(dur_s/dist_mi) if dist_mi>0 and dur_s>0 else None
                pace=(f"{int(pace_s_mi//60)}:{int(pace_s_mi%60):02d}/mi" if pace_s_mi is not None else "?")
                hr=f" HR{int(r['average_heartrate'])}" if r.get("average_heartrate") else ""
                te=f" TE{r['training_effect']:.1f}" if r.get("training_effect") else ""
                lines.append(f"  {(r.get('start_time') or '')[:10]} {dist_mi:.1f}mi {pace}{hr}{te}")
        if g.get("weekly_trend"):
            recent=g["weekly_trend"][-4:]
            lines.append("Weekly mi (last 4 weeks): "+", ".join(
                f"{w['week'][5:]}:{(w['distance_m']/M_PER_MI):.1f}" for w in recent))
        if g.get("race_predictions"):
            lines.append("Race predictions:")
            for rp in g["race_predictions"][:4]:
                secs=rp.get("time_seconds")
                if secs:
                    h=int(secs//3600); m=int((secs%3600)//60); s=int(secs%60)
                    t=f"{h}:{m:02d}:{s:02d}" if h else f"{m}:{s:02d}"
                else:
                    t="?"
                lines.append(f"  {rp.get('distance','')} — {t}")
        if g.get("personal_records"):
            lines.append("PRs:")
            for pr in g["personal_records"][:4]:
                secs=pr.get("time_seconds") or pr.get("time")
                if secs and isinstance(secs,(int,float)):
                    h=int(secs//3600); m=int((secs%3600)//60); s=int(secs%60)
                    t=f"{h}:{m:02d}:{s:02d}" if h else f"{m}:{s:02d}"
                else:
                    t=str(secs or "?")
                lines.append(f"  {pr.get('distance','')} — {t} ({(pr.get('date') or '')[:10]})")
    return "\n".join(lines)+"\n"

SYSTEM="""You are RunRec, an expert running shoe advisor.
Cite names, weight, drop, lab results. Be conversational.
Use athlete data when present: flag worn shoes, match shoe type to paces/mileage/training load.
Keep responses clear and scannable.
Always present distance in miles (mi) and pace in /mi, never in kilometers (km) or /km.
Use light GitHub-flavored Markdown for readability.
Bold key shoe names and short recommendation headers when helpful.
Use bullet lists for tradeoffs or ranked options.
Do not wrap the whole response in code fences unless the user explicitly asks for code.
If shopping preferences are provided, use them when discussing buy links and availability."""

class Msg(BaseModel):
    role: str; content: str

class ShoppingPrefs(BaseModel):
    shoe_size: Optional[str] = None
    shoe_gender: Optional[str] = None

class ChatReq(BaseModel):
    message: str
    history: list[Msg]=[]
    athlete_context: Optional[dict]=None
    shopping_preferences: Optional[ShoppingPrefs]=None

class ChatResp(BaseModel):
    response: str
    citations: list[dict[str, Any]] = []

class ShoeCatalogSearchResp(BaseModel):
    results: list[dict[str, Any]]

class ShoeCompareReq(BaseModel):
    models: list[str]
    athlete_data: Optional[dict]=None
    training_data: Optional[dict]=None

class ShoeCompareResp(BaseModel):
    shoes: list[dict[str, Any]]
    comparison: dict[str, Any]

class InsightReq(BaseModel):
    athlete_data: Optional[dict]=None
    training_data: Optional[dict]=None

@app.post("/chat",response_model=ChatResp)
async def chat(req: ChatReq, x_session_token: Optional[str]=Header(default=None)):
    _auth(x_session_token)
    if not _effective_llm_settings()["configured"]:
        raise HTTPException(500, "No model configured. Add OpenAI or a Tailscale-hosted local model in Connect.")
    system = f"{_agents_md}\n\n{SYSTEM}".strip() if _agents_md else SYSTEM
    msgs=[{"role":"system","content":system}]
    msgs+=[{"role":m.role,"content":m.content} for m in req.history]
    body=req.message
    ath=_athlete_ctx(req.athlete_context)
    if ath: body+=f"\n\n{ath}"
    prefs = req.shopping_preferences
    if prefs and (prefs.shoe_size or prefs.shoe_gender):
        pref_bits = []
        if prefs.shoe_gender:
            pref_bits.append(f"Shop for {prefs.shoe_gender}.")
        if prefs.shoe_size:
            pref_bits.append(f"Preferred size: {prefs.shoe_size}.")
        body += f"\n\n[Shopping Preferences]\n{' '.join(pref_bits)}"
    retrieval_text, retrieval_citations = retrieve_context(req.message)
    body+=f"\n\n[Shoe DB]\n{retrieval_text}"
    msgs.append({"role":"user","content":body})
    llm_response = _chat_completion(msgs, max_tokens=1000, temperature=0.7)

    # Only fetch buy links for replacement or current-rotation requests.
    buy_citations: list[dict] = []
    try:
        models = _recommended_models_from_response(llm_response)
        if _should_fetch_buy_links(req.message) and models and os.environ.get("YOU_API_KEY"):
            buy_map = await find_buy_links_multi(
                models,
                max_per_shoe=10,
                shoe_size=(prefs.shoe_size if prefs else None),
                shoe_gender=(prefs.shoe_gender if prefs else None),
            )
            buy_citations = format_buy_links_as_citations(buy_map)
    except Exception as e:
        print(f"[Chat] Buy link fetch failed (non-fatal): {e}")

    source_citations = _athlete_context_citations(req.athlete_context) + retrieval_citations
    citations = buy_citations + source_citations[:7]
    return ChatResp(response=llm_response, citations=citations)

@app.get("/shoe-catalog/search", response_model=ShoeCatalogSearchResp)
async def shoe_catalog_search(q: str = Query(..., min_length=1), limit: int = Query(8, ge=1, le=12),
                              x_session_token: Optional[str]=Header(default=None)):
    _auth(x_session_token)
    return ShoeCatalogSearchResp(results=_search_catalog(q, limit=limit))

@app.post("/shoe-catalog/compare", response_model=ShoeCompareResp)
async def shoe_catalog_compare(req: ShoeCompareReq, x_session_token: Optional[str]=Header(default=None)):
    _auth(x_session_token)
    models = [m for m in req.models if str(m or "").strip()]
    if len(models) < 2:
        raise HTTPException(400, "Provide two shoe models to compare")

    shoes = []
    for model in models[:2]:
        entry = _catalog_entry_by_model(model)
        if not entry:
            raise HTTPException(404, f"Shoe not found in catalog: {model}")
        shoes.append(entry)

    athlete = req.athlete_data if isinstance(req.athlete_data, dict) else {}
    training = req.training_data if isinstance(req.training_data, dict) else {}
    rotation = compute_shoe_rotation_insights(athlete, training)
    demand = rotation.get("rotation_summary", {}).get("dominant_demand") or []
    demand_tags = [d.get("type") for d in demand if isinstance(d, dict) and d.get("type")]

    fit_notes = []
    for shoe in shoes:
        tags = shoe.get("usage_tags") or []
        aligned = [tag for tag in demand_tags if tag in tags]
        if aligned:
            fit = f"Best fit for your current {', '.join(aligned)} demand."
        elif "daily" in tags:
            fit = "Best fit for general daily mileage."
        elif "race" in tags or "speed" in tags or "tempo" in tags:
            fit = "Best fit for workouts and faster sessions."
        else:
            fit = "Useful as a secondary rotation option."
        fit_notes.append({
            "model": shoe["model"],
            "fit_summary": fit,
        })

    shoe_a, shoe_b = shoes[0], shoes[1]
    comparison_points = []
    if shoe_a.get("support") != shoe_b.get("support") and shoe_a.get("support") and shoe_b.get("support"):
        comparison_points.append(
            f"{shoe_a['model']} is {shoe_a['support']}, while {shoe_b['model']} is {shoe_b['support']}."
        )
    if shoe_a.get("weight_oz") and shoe_b.get("weight_oz"):
        lighter = shoe_a if shoe_a["weight_oz"] < shoe_b["weight_oz"] else shoe_b
        comparison_points.append(f"{lighter['model']} is the lighter option by lab weight.")
    if shoe_a.get("drop_mm") and shoe_b.get("drop_mm"):
        higher = shoe_a if shoe_a["drop_mm"] > shoe_b["drop_mm"] else shoe_b
        comparison_points.append(f"{higher['model']} has the higher heel-to-toe drop.")
    if demand_tags:
        comparison_points.append(f"Current training demand is led by: {', '.join(demand_tags[:3])}.")

    return ShoeCompareResp(
        shoes=shoes,
        comparison={
            "fit_notes": fit_notes,
            "points": comparison_points,
            "demand_tags": demand_tags,
            "sources": _athlete_context_citations(athlete, training) + [
                {
                    "kind": "shoe_db",
                    "label": shoe["model"],
                    "detail": "RunRepeat catalog entry used for side-by-side comparison.",
                    "url": shoe.get("url"),
                }
                for shoe in shoes
            ],
        },
    )

@app.post("/insights")
async def runner_insights(req: InsightReq, x_session_token: Optional[str]=Header(default=None)):
    _auth(x_session_token)
    athlete = req.athlete_data if isinstance(req.athlete_data, dict) else {}
    training = req.training_data if isinstance(req.training_data, dict) else {}
    garmin = athlete.get("garmin") if isinstance(athlete, dict) else {}
    strava = athlete.get("strava") if isinstance(athlete, dict) else {}
    analytics_source = dict(garmin if isinstance(garmin, dict) else {})

    if isinstance(strava, dict):
        if isinstance(strava.get("recent_runs"), list) and strava.get("recent_runs"):
            analytics_source["recent_runs"] = strava.get("recent_runs")
        if isinstance(strava.get("weekly_trend"), list) and strava.get("weekly_trend"):
            analytics_source["weekly_trend"] = strava.get("weekly_trend")

    return {
        "shoe_rotation": compute_shoe_rotation_insights(athlete, training),
        "long_term_analytics": compute_long_term_analytics(analytics_source, training),
        "recovery_alerts": compute_recovery_alerts(garmin if isinstance(garmin, dict) else {}, training),
    }

@app.get("/refresh-status")
async def refresh_status(x_session_token: Optional[str] = Header(default=None)):
    """Returns when data was last auto-refreshed and triggers an immediate refresh."""
    _auth(x_session_token)
    return {
        "last_refresh_at": _last_refresh_at.isoformat() if _last_refresh_at else None,
        "intervals_cached": _cached_intervals_data is not None,
        "refresh_interval_minutes": REFRESH_INTERVAL_MINUTES,
    }

@app.post("/refresh-now")
async def refresh_now(x_session_token: Optional[str] = Header(default=None)):
    """Trigger an immediate background data refresh."""
    _auth(x_session_token)
    asyncio.create_task(_do_refresh())
    return {"ok": True, "message": "Refresh triggered"}

@app.get("/shoes/buy")
async def shoes_buy(
    model: str = Query(..., min_length=2, description="Shoe model name, e.g. 'Nike Vomero 18'"),
    max_results: int = Query(10, ge=1, le=10),
    x_session_token: Optional[str] = Header(default=None),
):
    """Find the cheapest places to buy a specific shoe. Cached for 7 days."""
    _auth(x_session_token)
    if not os.environ.get("YOU_API_KEY"):
        raise HTTPException(503, "YOU_API_KEY not configured on the server.")
    results = await find_buy_links(model, max_results=max_results)
    return {"model": model, "results": results}

@app.delete("/shoes/buy/cache")
async def shoes_buy_cache_clear(
    model: Optional[str] = Query(default=None),
    x_session_token: Optional[str] = Header(default=None),
):
    """Clear the shoe price cache for one model or all."""
    _auth(x_session_token)
    import sqlite3 as _sq
    from shoe_prices import CACHE_DB, _shoe_key
    try:
        con = _sq.connect(CACHE_DB)
        if model:
            con.execute("DELETE FROM price_cache WHERE shoe_key=?", (_shoe_key(model),))
            msg = f"Cache cleared for '{model}'"
        else:
            con.execute("DELETE FROM price_cache")
            msg = "Entire price cache cleared"
        con.commit(); con.close()
        return {"ok": True, "message": msg}
    except Exception as e:
        raise HTTPException(500, f"Cache clear failed: {e}")

@app.get("/debug/you")
async def debug_you(x_session_token: Optional[str] = Header(default=None)):
    _auth(x_session_token)
    key = os.environ.get("YOU_API_KEY", "").strip()
    return {
        "configured": bool(key),
        "masked_key": _masked_search_key("YOU_API_KEY"),
        "length": len(key),
        "starts_with_api_key_prefix": bool(key),
    }

@app.get("/debug/brave")
async def debug_brave_compat(x_session_token: Optional[str] = Header(default=None)):
    return await debug_you(x_session_token=x_session_token)

@app.get("/health")
async def health():
    out={"status":"ok"}
    try: out["shoes"]=get_coll().count()
    except Exception as e: out["chroma_err"]=str(e)
    out["garmin"]=_garmin_cli is not None; out["strava"]=bool(_strava_id)
    out["you_search"]=bool(os.environ.get("YOU_API_KEY"))
    out["you_key_masked"]=_masked_search_key("YOU_API_KEY")
    return out

if __name__=="__main__":
    import uvicorn; uvicorn.run("server:app",host="0.0.0.0",port=8000,reload=False)
