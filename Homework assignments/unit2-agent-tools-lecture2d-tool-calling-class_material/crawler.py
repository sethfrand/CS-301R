"""
crawler.py — General Conference quote finder using Playwright.

Install dependencies:
    pip install playwright beautifulsoup4 lxml
    playwright install chromium
"""

import re
from difflib import SequenceMatcher

from bs4 import BeautifulSoup
from playwright.sync_api import sync_playwright, TimeoutError as PWTimeout

BASE = "https://www.churchofjesuschrist.org"

MATCH_THRESHOLD = 0.50
DEBUG = True  # Set to False to silence debug output


def _debug(msg: str):
    if DEBUG:
        print(f"[crawler] {msg}", flush=True)


# --------------------
# Playwright fetch
# --------------------
def _pw_fetch(url: str, wait_selector: str | None = None, timeout: int = 15000) -> str:
    """Fetch a fully JS-rendered page with Playwright."""
    _debug(f"Fetching: {url}")
    with sync_playwright() as pw:
        browser = pw.chromium.launch(headless=True)
        page = browser.new_page(user_agent="Mozilla/5.0 (compatible; QuoteFinder/1.0)")
        try:
            page.goto(url, wait_until="networkidle", timeout=timeout)
            if wait_selector:
                page.wait_for_selector(wait_selector, timeout=timeout)
            html = page.content()
            _debug(f"  → got {len(html)} chars")
        except PWTimeout:
            html = page.content()
            _debug(f"  → timeout, got {len(html)} chars")
        except Exception as e:
            _debug(f"  → ERROR: {e}")
            html = ""
        finally:
            browser.close()
    return html


# --------------------
# Speaker → talk URLs
# --------------------
def _speaker_name_to_slug(speaker_name: str) -> str:
    """
    Convert a full name to the URL slug used by the speakers index.
    e.g. "Dallin H. Oaks"    → "dallin-h-oaks"
         "Russell M. Nelson" → "russell-m-nelson"
    """
    slug = speaker_name.lower().strip()
    slug = re.sub(r"[^a-z0-9\s-]", "", slug)  # remove punctuation (periods, etc.)
    slug = re.sub(r"\s+", "-", slug)           # spaces → hyphens
    slug = re.sub(r"-+", "-", slug)            # collapse multiple hyphens
    return slug.strip("-")


def find_speaker_talks(speaker_name: str) -> list[dict]:
    """
    Fetch all General Conference talks for `speaker_name` from their
    dedicated speaker page:
        https://www.churchofjesuschrist.org/study/general-conference/speakers/{slug}?lang=eng

    One page fetch — no session crawling needed.
    """
    slug = _speaker_name_to_slug(speaker_name)
    speaker_url = f"{BASE}/study/general-conference/speakers/{slug}?lang=eng"
    _debug(f"Speaker page: {speaker_url}")

    html = _pw_fetch(speaker_url, wait_selector="a[href]", timeout=20000)
    if not html:
        return []

    soup = BeautifulSoup(html, "lxml")
    talks: list[dict] = []
    seen_urls: set[str] = set()

    for a in soup.find_all("a", href=True):
        href = a["href"]
        if href.startswith("/"):
            href = BASE + href

        if not re.search(r"/general-conference/\d{4}/\d{2}/.+", href):
            continue

        if href in seen_urls:
            continue

        seen_urls.add(href)
        title = a.get_text(" ", strip=True) or href.split("/")[-1]
        talks.append({"title": title, "url": href})

    _debug(f"Found {len(talks)} talk(s) for '{speaker_name}'")
    return talks


# --------------------
# Quote extraction
# --------------------
def find_quote_in_talk(talk_url: str, paraphrased_query: str) -> dict:
    """
    Fetch a talk and return the paragraph most similar to `paraphrased_query`.
    Uses combined fuzzy-ratio + keyword-overlap scoring.
    """
    html = _pw_fetch(talk_url, wait_selector="p")
    if not html:
        return {"found": False, "source_url": talk_url}

    soup = BeautifulSoup(html, "lxml")
    paragraphs = [
        p.get_text(" ", strip=True)
        for p in soup.find_all("p")
        if len(p.get_text(strip=True)) > 40
    ]

    _debug(f"  {len(paragraphs)} paragraph(s) in talk")

    if not paragraphs:
        return {"found": False, "source_url": talk_url}

    query_lower = paraphrased_query.lower()
    query_words = set(query_lower.split())
    best_score = 0.0
    best_para = ""

    for para in paragraphs:
        para_lower = para.lower()
        fuzzy = SequenceMatcher(None, query_lower, para_lower).ratio()
        para_words = set(para_lower.split())
        overlap = len(query_words & para_words) / max(len(query_words), 1)
        combined = fuzzy * 0.5 + overlap * 0.5

        if combined > best_score:
            best_score = combined
            best_para = para

    _debug(f"  Best score: {best_score:.3f} (threshold {MATCH_THRESHOLD})")

    if best_score >= MATCH_THRESHOLD and best_para:
        return {
            "found": True,
            "source_url": talk_url,
            "exact_quote": best_para,
            "confidence": round(best_score, 3),
        }

    return {"found": False, "source_url": talk_url}


# --------------------
# Public API
# --------------------
def scrape_web(query: str, speaker: str = "", url: str | None = None) -> dict:
    """
    Main entry point called by the chatbot tool.

    Args:
        query:   Paraphrased or partial quote the user remembers.
        speaker: Full name of the speaker (e.g. 'Dallin H. Oaks').
        url:     Optional direct URL to a specific talk — skips speaker lookup.
    """
    _debug(f"scrape_web called — query={query!r}, speaker={speaker!r}, url={url!r}")

    # --- Direct URL mode ---
    if url:
        return find_quote_in_talk(url, query)

    # --- Speaker lookup mode ---
    if not speaker:
        return {
            "found": False,
            "message": "Please provide a speaker name so I can search their talks.",
        }

    talks = find_speaker_talks(speaker)

    if not talks:
        return {
            "found": False,
            "message": (
                f"No General Conference talks found for '{speaker}'. "
                f"Check the spelling — the name should match exactly as it appears "
                f"on the Church website (e.g. 'Dallin H. Oaks')."
            ),
        }

    _debug(f"Scanning {len(talks)} talk(s) for the quote...")
    for talk in talks:
        result = find_quote_in_talk(talk["url"], query)
        if result.get("found"):
            result["talk_title"] = talk["title"]
            _debug(f"  ✓ Found in: {talk['url']}")
            return result

    return {
        "found": False,
        "message": (
            f"Searched {len(talks)} talk(s) by '{speaker}' but couldn't find a strong match. "
            "Try rephrasing the quote with more distinctive words."
        ),
    }