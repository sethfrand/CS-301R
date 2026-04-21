"""
shoe_prices.py — Find the cheapest place to buy a running shoe.

Uses You.com Search with a SQLite cache so the same shoe is never searched
twice within CACHE_TTL_DAYS days.

Setup:
    export YOU_API_KEY="..."
"""
import os
import re
import sqlite3
import asyncio
import hashlib
from datetime import datetime, timedelta
from typing import Optional
from urllib.parse import urlparse

import httpx


# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------

SEARCH_API_URL = "https://ydc-index.io/v1/search"
CONTENTS_API_URL = "https://ydc-index.io/v1/contents"


def _search_key() -> str:
    return os.environ.get("YOU_API_KEY", "").strip()


CACHE_DB = os.path.join(os.path.dirname(__file__), "shoe_prices.db")
CACHE_TTL_DAYS = 7  # re-search after this many days
MAX_RESULTS = 10  # return the full retailer set by default
REQUEST_TIMEOUT = 8  # seconds
SEARCH_RESULT_COUNT = 8
CONTENT_CANDIDATE_COUNT = 3

# Limit simultaneous outbound requests so one slow network path doesn't stampede
# the API or make timeouts more likely.
MAX_CONCURRENT_RETAILER_SEARCHES = 4
_RETAILER_SEM = asyncio.Semaphore(MAX_CONCURRENT_RETAILER_SEARCHES)

# Retailers to search — ordered by general consumer trust / likelihood of
# having stock. The site: operators are added to the Brave query.
RETAILERS = [
    ("Dick's Sporting Goods", "dickssportinggoods.com"),
    ("REI", "rei.com"),
    ("Fleet Feet", "fleetfeet.com"),
    ("Nike", "nike.com"),
    ("Hoka", "hoka.com"),
    ("On", "on.com"),
    ("Adidas", "adidas.com"),
    ("Brooks", "brooksrunning.com"),
    ("Altra", "altrarunning.com"),
    ("Amazon", "amazon.com"),
    ("Nike Air", "nikeair.com"),
    ("Asics","https://www.asics.com/us/en-us/"),
    ("Saucony","https://www.saucony.com/en/home")

]

# Regex patterns to pull a price out of a search snippet
_PRICE_RE = re.compile(r"\$\s*(\d{1,4}(?:\.\d{2})?)")
_HTML_TAG_RE = re.compile(r"<[^>]+>")
_STRUCTURED_PRICE_PATTERNS = [
    re.compile(r'"price"\s*:\s*"?(?P<price>\d{1,4}(?:\.\d{2})?)"?', re.I),
    re.compile(r'"lowPrice"\s*:\s*"?(?P<price>\d{1,4}(?:\.\d{2})?)"?', re.I),
    re.compile(r'itemprop=["\']price["\'][^>]*content=["\'](?P<price>\d{1,4}(?:\.\d{2})?)["\']', re.I),
    re.compile(r'data-price=["\'](?P<price>\d{1,4}(?:\.\d{2})?)["\']', re.I),
]


# ---------------------------------------------------------------------------
# Cache (SQLite — single file, no server required)
# ---------------------------------------------------------------------------

def _db() -> sqlite3.Connection:
    con = sqlite3.connect(CACHE_DB)
    con.execute("""
                CREATE TABLE IF NOT EXISTS price_cache
                (
                    shoe_key
                    TEXT
                    NOT
                    NULL,
                    retailer
                    TEXT
                    NOT
                    NULL,
                    url
                    TEXT,
                    price_cents
                    INTEGER,
                    price_str
                    TEXT,
                    title
                    TEXT,
                    fetched_at
                    TEXT
                    NOT
                    NULL,
                    PRIMARY
                    KEY
                (
                    shoe_key,
                    retailer
                )
                    )
                """)
    con.commit()
    return con


def _shoe_key(model: str, shoe_size: Optional[str] = None, shoe_gender: Optional[str] = None) -> str:
    """Stable cache key from a shoe model name and shopping preferences."""
    base = "|".join([
        model.strip().lower(),
        str(shoe_size or "").strip().lower(),
        str(shoe_gender or "").strip().lower(),
    ])
    return hashlib.md5(base.encode()).hexdigest()


def _sort_results(results: list[dict]) -> list[dict]:
    priced = sorted(
        [result for result in results if result.get("price_cents") is not None],
        key=lambda item: item["price_cents"],
        reverse=True,
    )
    unpriced = sorted(
        [result for result in results if result.get("price_cents") is None],
        key=lambda item: item.get("score", 0),
        reverse=True,
    )
    return priced + unpriced


def _cached_results(model: str, shoe_size: Optional[str] = None, shoe_gender: Optional[str] = None) -> Optional[list[dict]]:
    """Return cached results if still fresh, else None."""
    key = _shoe_key(model, shoe_size=shoe_size, shoe_gender=shoe_gender)
    cutoff = (datetime.utcnow() - timedelta(days=CACHE_TTL_DAYS)).isoformat()
    con = _db()
    rows = con.execute(
        "SELECT retailer, url, price_cents, price_str, title "
        "FROM price_cache WHERE shoe_key=? AND fetched_at>?",
        (key, cutoff),
    ).fetchall()
    con.close()
    if not rows:
        return None
    return _sort_results([
        {"retailer": r[0], "url": r[1], "price_cents": r[2],
         "price_str": r[3], "title": r[4]}
        for r in rows
    ])


def _write_cache(model: str, results: list[dict], shoe_size: Optional[str] = None, shoe_gender: Optional[str] = None):
    key = _shoe_key(model, shoe_size=shoe_size, shoe_gender=shoe_gender)
    now = datetime.utcnow().isoformat()
    con = _db()
    for r in results:
        con.execute(
            "INSERT OR REPLACE INTO price_cache "
            "(shoe_key, retailer, url, price_cents, price_str, title, fetched_at) "
            "VALUES (?,?,?,?,?,?,?)",
            (key, r["retailer"], r["url"], r["price_cents"], r["price_str"], r["title"], now),
        )
    con.commit()
    con.close()


# ---------------------------------------------------------------------------
# You.com Search
# ---------------------------------------------------------------------------

def _parse_price(text: str) -> tuple[Optional[int], Optional[str]]:
    """Extract the first dollar price from a text snippet. Returns (cents, str)."""
    m = _PRICE_RE.search(text or "")
    if not m:
        return None, None
    dollars = float(m.group(1))
    return int(dollars * 100), f"${dollars:.2f}"


async def _search_web(query: str) -> list[dict]:
    """Call You.com Search API and return raw web results."""
    if not _search_key():
        return []

    headers = {
        "Accept": "application/json",
        "Accept-Encoding": "gzip",
        "X-API-Key": _search_key(),
    }
    params = {
        "query": query,
        "count": SEARCH_RESULT_COUNT,
        "country": "US",
        "language": "EN",
        "safesearch": "off",
        "freshness": "month",
    }
    try:
        async with httpx.AsyncClient(timeout=REQUEST_TIMEOUT) as c:
            response = await c.get(SEARCH_API_URL, headers=headers, params=params)
            response.raise_for_status()
            data = response.json()
            return data.get("results", {}).get("web", [])
    except Exception as e:
        print(f"[YouSearch] Error: {e}")
        return []


async def _fetch_contents(urls: list[str]) -> list[dict]:
    """Fetch page contents from You.com for URL validation."""
    if not _search_key() or not urls:
        return []

    headers = {
        "Accept": "application/json",
        "Accept-Encoding": "gzip",
        "Content-Type": "application/json",
        "X-API-Key": _search_key(),
    }
    payload = {
        "urls": urls,
        "format": "html",
    }
    try:
        async with httpx.AsyncClient(timeout=REQUEST_TIMEOUT * 2) as client:
            response = await client.post(CONTENTS_API_URL, headers=headers, json=payload)
            response.raise_for_status()
            data = response.json()
            return data if isinstance(data, list) else []
    except Exception as e:
        print(f"[YouContents] Error: {e}")
        return []


def _clean_search_text(*parts: str) -> str:
    merged = " ".join(part for part in parts if part)
    return _HTML_TAG_RE.sub("", merged).strip()


def _domain_matches(url: str, domain: str) -> bool:
    try:
        hostname = (urlparse(url).hostname or "").lower()
    except Exception:
        return False
    return hostname == domain or hostname.endswith(f".{domain}")


def _looks_like_product_page(url: str) -> bool:
    lowered = url.lower()
    tokens = [
        "/product",
        "/products",
        "/shoe",
        "/shoes",
        "/running",
        "/footwear",
        "/p/",
        "/dp/",
    ]
    return any(token in lowered for token in tokens)


def _score_result(model: str, domain: str, result: dict) -> int:
    url = result.get("url", "")
    title = _clean_search_text(result.get("title", ""))
    description = _clean_search_text(
        result.get("description", ""),
        *(result.get("snippets") or []),
    )
    haystack = f"{title} {description}".lower()
    model_tokens = [token for token in re.split(r"[^a-z0-9]+", model.lower()) if token]

    score = 0
    if _domain_matches(url, domain):
        score += 40
    if _looks_like_product_page(url):
        score += 30

    match_count = sum(1 for token in model_tokens if token in haystack or token in url.lower())
    score += match_count * 8

    if model.lower() in haystack:
        score += 20
    if "$" in haystack:
        score += 10
    if "review" in haystack:
        score -= 12
    if "search" in url.lower() or "category" in url.lower():
        score -= 15

    return score


def _shopping_tokens(shoe_size: Optional[str], shoe_gender: Optional[str]) -> str:
    parts = []
    if shoe_gender == "mens":
        parts.append("mens")
    elif shoe_gender == "womens":
        parts.append("womens")
    if shoe_size:
        parts.extend(["size", str(shoe_size).strip()])
    return " ".join(parts)


def _normalize_text(value: str) -> str:
    return re.sub(r"\s+", " ", str(value or "").lower()).strip()


def _price_to_tuple(raw_price: str) -> tuple[Optional[int], Optional[str]]:
    try:
        dollars = float(raw_price)
    except Exception:
        return None, None
    return int(dollars * 100), f"${dollars:.2f}"


def _extract_structured_price(html: str) -> tuple[Optional[int], Optional[str]]:
    source = str(html or "")
    for pattern in _STRUCTURED_PRICE_PATTERNS:
        match = pattern.search(source)
        if match:
            return _price_to_tuple(match.group("price"))
    return None, None


def _extract_contextual_price(text: str) -> tuple[Optional[int], Optional[str]]:
    source = str(text or "")
    candidates: list[tuple[int, int, str]] = []
    for match in _PRICE_RE.finditer(source):
        start, end = match.span()
        window = source[max(0, start - 80): min(len(source), end + 80)].lower()
        score = 0
        if any(keyword in window for keyword in ("price", "sale", "now", "member", "our price", "msrp", "usd")):
            score += 20
        if any(keyword in window for keyword in ("from $", "as low as", "afterpay", "klarna", "/mo", "per month", "save")):
            score -= 15
        candidates.append((score, start, match.group(1)))

    if not candidates:
        return None, None

    candidates.sort(key=lambda item: (item[0], -item[1]), reverse=True)
    return _price_to_tuple(candidates[0][2])


def _validate_page_content(
    model: str,
    text: str,
    html: str,
    shoe_size: Optional[str] = None,
    shoe_gender: Optional[str] = None,
) -> tuple[int, Optional[int], Optional[str]]:
    normalized = _normalize_text(text)
    model_tokens = [token for token in re.split(r"[^a-z0-9]+", model.lower()) if token]
    score = 0

    token_hits = sum(1 for token in model_tokens if token in normalized)
    score += token_hits * 10

    if model.lower() in normalized:
        score += 25
    if shoe_gender == "mens" and ("men's" in normalized or "mens" in normalized):
        score += 8
    if shoe_gender == "womens" and ("women's" in normalized or "womens" in normalized):
        score += 8
    if shoe_size:
        size_patterns = [
            f"size {str(shoe_size).strip().lower()}",
            f"us {str(shoe_size).strip().lower()}",
        ]
        if any(pattern in normalized for pattern in size_patterns):
            score += 6

    price_cents, price_str = _extract_structured_price(html)
    if price_cents is None:
        price_cents, price_str = _extract_contextual_price(text)
    if price_cents is not None:
        score += 20

    return score, price_cents, price_str


async def _search_one_retailer(
    model: str,
    retailer_name: str,
    domain: str,
    shoe_size: Optional[str] = None,
    shoe_gender: Optional[str] = None,
) -> Optional[dict]:
    """Search You.com for a shoe at a specific retailer. Returns best result or None."""
    preference_terms = _shopping_tokens(shoe_size, shoe_gender)
    query = f"\"{model}\" {preference_terms} running shoe site:{domain}".strip()
    results = await _search_web(query)
    if not results:
        return None

    scored = sorted(results, key=lambda result: _score_result(model, domain, result), reverse=True)
    candidates = [
        result for result in scored[:CONTENT_CANDIDATE_COUNT]
        if _domain_matches(result.get("url", ""), domain)
    ]
    if not candidates:
        return None

    content_docs = await _fetch_contents([candidate.get("url", "") for candidate in candidates if candidate.get("url")])
    content_by_url = {
        doc.get("url"): doc
        for doc in content_docs
        if isinstance(doc, dict) and doc.get("url")
    }

    best_match = None
    best_score = -1
    for candidate in candidates:
        url = candidate.get("url", "")
        title = _clean_search_text(candidate.get("title", ""))
        snippet = _clean_search_text(candidate.get("description", ""), *(candidate.get("snippets") or []))
        search_score = _score_result(model, domain, candidate)
        if search_score < 45 or not url:
            continue

        doc = content_by_url.get(url) or {}
        doc_html = doc.get("html", "") if isinstance(doc, dict) else ""
        content_text = _clean_search_text(
            doc.get("title", ""),
            _HTML_TAG_RE.sub(" ", doc_html),
        )
        content_score, content_price_cents, content_price_str = _validate_page_content(
            model,
            content_text,
            doc_html,
            shoe_size=shoe_size,
            shoe_gender=shoe_gender,
        )
        snippet_price_cents, snippet_price_str = _parse_price(f"{snippet} {title}")
        total_score = search_score + content_score
        price_cents = content_price_cents if content_price_cents is not None else snippet_price_cents
        price_str = content_price_str if content_price_str is not None else snippet_price_str

        match = {
            "retailer": retailer_name,
            "url": url,
            "price_cents": price_cents,
            "price_str": price_str,
            "title": title,
            "snippet": snippet,
            "score": total_score,
            "validated": bool(content_text),
        }
        if total_score > best_score:
            best_score = total_score
            best_match = match

        return best_match


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

# ... existing code ...

async def find_buy_links(
    model: str,
    max_results: int = MAX_RESULTS,
    shoe_size: Optional[str] = None,
    shoe_gender: Optional[str] = None,
) -> list[dict]:
    """
    Return a list of retailer buy links for `model`, sorted by price descending.
    Results are cached for CACHE_TTL_DAYS days and can be narrowed by size/category.
    """
    cached = _cached_results(model, shoe_size=shoe_size, shoe_gender=shoe_gender)
    if cached is not None:
        print(f"[ShoePrice] Cache hit for '{model}' ({len(cached)} results)")
        return cached[:max_results]

    if not _search_key():
        print("[ShoePrice] YOU_API_KEY not set — skipping price search")
        return []

    pref_suffix = " ".join(part for part in [
        shoe_gender if shoe_gender else None,
        f"size {shoe_size}" if shoe_size else None,
    ] if part)
    print(f"[ShoePrice] Searching for '{model}' across {len(RETAILERS)} retailers{f' ({pref_suffix})' if pref_suffix else ''}...")

    tasks = [
        _search_one_retailer(model, name, domain, shoe_size=shoe_size, shoe_gender=shoe_gender)
        for name, domain in RETAILERS
    ]
    raw = await asyncio.gather(*tasks, return_exceptions=True)

    results = []
    for item in raw:
        if isinstance(item, Exception):
            print(f"[ShoePrice] retailer search failed: {item}")
            continue
        if item is not None:
            results.append(item)

    deduped = []
    seen_urls = set()
    for result in results:
        url = result.get("url")
        if not url or url in seen_urls:
            continue
        seen_urls.add(url)
        deduped.append(result)
    results = deduped

    results = _sort_results(results)

    _write_cache(model, results, shoe_size=shoe_size, shoe_gender=shoe_gender)
    print(f"[ShoePrice] Found {len(results)} results for '{model}'")
    return results[:max_results]


async def find_buy_links_multi(
    models: list[str],
    max_per_shoe: int = MAX_RESULTS,
    shoe_size: Optional[str] = None,
    shoe_gender: Optional[str] = None,
) -> dict[str, list[dict]]:
    """Fetch buy links for multiple shoes in parallel."""
    tasks = {
        model: find_buy_links(model, max_per_shoe, shoe_size=shoe_size, shoe_gender=shoe_gender)
        for model in models
    }
    results = await asyncio.gather(*tasks.values(), return_exceptions=True)
    out: dict[str, list[dict]] = {}
    for model, result in zip(tasks.keys(), results):
        out[model] = [] if isinstance(result, Exception) else result
    return out


def extract_shoe_models_from_text(text: str) -> list[str]:
    """
    Extract running shoe model names from LLM response text.
    Handles bold markdown (**Nike Vomero 18**), plain text, mixed case.
    Returns deduplicated list of up to 5 models.
    """
    # Strip markdown bold/italic so "**Nike Vomero 18**" becomes "Nike Vomero 18"
    clean = re.sub(r"[*_`]", "", text)

    brands = [
        "Nike", "Hoka", "Adidas", "Brooks", "Altra", "Saucony",
        "ASICS", "New Balance", "Mizuno", "Salomon", "On Running",
        "Puma", "Reebok", "Newton", "Topo", "Craft", "Karhu",
        "Norda", "Lululemon", "Under Armour",
    ]

    found = []
    seen = set()

    # Primary pattern: Brand Model [optional version number]
    # e.g. "Nike Vomero 18", "Hoka Clifton 9 Wide", "ASICS Gel-Nimbus 26"
    brand_pat = "|".join(re.escape(b) for b in brands)
    pattern = re.compile(
        rf"(?i)(?:{brand_pat})"  # brand (case-insensitive)
        r"[ \t]+"  # space(s)
        r"[A-Za-z][A-Za-z0-9\-]+"  # model word (e.g. "Clifton", "Gel-Nimbus")
        r"(?:[ \t]+[A-Za-z0-9]+){0,3}",  # up to 3 more words/numbers (e.g. "9 Wide" or "GTX 2")
        re.UNICODE,
    )

    for m in pattern.finditer(clean):
        raw = m.group(0).strip()
        # Normalise title-case so "nike vomero 18" and "Nike Vomero 18" dedup correctly
        model = " ".join(w.capitalize() if w.lower() not in ("for", "the", "and", "with")
                         else w for w in raw.split())
        key = model.lower()
        if key not in seen and len(model) > 5:
            seen.add(key)
            found.append(model)
        if len(found) >= 5:
            break

    return found


def format_buy_links_as_citations(
        buy_map: dict[str, list[dict]]
) -> list[dict]:
    """
    Convert buy links into the citation format the chat endpoint already uses:
        { kind, label, detail, url }
    """
    citations = []
    for model, links in buy_map.items():
        if not links:
            continue
        first = links[0]
        price_label = first["price_str"] or "price not listed"
        citations.append({
            "kind": "buy_link",
            "label": f"Buy: {model}",
            "detail": f"Highest listed price: {price_label} at {first['retailer']}",
            "url": first["url"],
            "model": model,
        })
        for link in links[1:]:
            price_label = link["price_str"] or "price not listed"
            citations.append({
                "kind": "buy_link",
                "label": f"{link['retailer']}",
                "detail": f"{price_label}",
                "url": link["url"],
                "model": model,
            })
    return citations
