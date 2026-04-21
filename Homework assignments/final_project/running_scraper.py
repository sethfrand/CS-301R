import asyncio
import re
import json
import pandas as pd
from tqdm import tqdm
from playwright.async_api import async_playwright

CATALOG = "https://runrepeat.com/catalog/running-shoes"

# Shoe pages look like: runrepeat.com/nike-vomero-plus
# Single slug, no sub-paths (excludes /catalog/..., /deals/..., /redirect/..., etc.)
SHOE_URL_RE = re.compile(r"^https://runrepeat\.com/[a-z0-9][a-z0-9-]+$")

def is_shoe_url(href):
    return bool(SHOE_URL_RE.match(href))


# -----------------------------
# Collect links across all pages
# -----------------------------
async def get_all_links(page):
    all_links = set()

    # Load first page to detect pagination
    await page.goto(CATALOG, wait_until="networkidle", timeout=60000)
    await page.wait_for_timeout(2000)

    last_page = 1
    try:
        hrefs = await page.eval_on_selector_all(
            "a[href*='page=']",
            "els => els.map(e => e.href)"
        )
        for href in hrefs:
            m = re.search(r"page=(\d+)", href)
            if m:
                last_page = max(last_page, int(m.group(1)))
    except Exception:
        pass

    print(f"Detected {last_page} catalog page(s)")

    for page_num in range(1, last_page + 1):
        url = CATALOG if page_num == 1 else f"{CATALOG}?page={page_num}"
        try:
            await page.goto(url, wait_until="networkidle", timeout=60000)
            await page.wait_for_timeout(1500)

            # Scroll to trigger lazy-loaded cards
            for _ in range(8):
                await page.evaluate("window.scrollBy(0, 1200)")
                await page.wait_for_timeout(400)

            hrefs = await page.eval_on_selector_all(
                "a[href]",
                "els => els.map(e => e.href)"
            )
            shoe_links = [h for h in hrefs if is_shoe_url(h)]
            all_links.update(shoe_links)
            print(f"  Page {page_num}/{last_page}: +{len(shoe_links)} shoes (total: {len(all_links)})")

        except Exception as e:
            print(f"  Page {page_num}: failed — {e}")

    return list(all_links)


# -----------------------------
# Extract shoe page data
# -----------------------------
async def scrape_shoe(page, url):
    await page.goto(url, wait_until="domcontentloaded", timeout=30000)
    await page.wait_for_timeout(1500)

    model = (await page.locator("h1").first.inner_text()).strip()

    # Pros
    pros = []
    for sel in ["[class*='pros'] li", "[class*='pro-list'] li", "[data-type='pros'] li"]:
        try:
            items = await page.locator(sel).all_inner_texts()
            if items:
                pros = [i.strip() for i in items if i.strip()]
                break
        except Exception:
            pass

    # Cons
    cons = []
    for sel in ["[class*='cons'] li", "[class*='con-list'] li", "[data-type='cons'] li"]:
        try:
            items = await page.locator(sel).all_inner_texts()
            if items:
                cons = [i.strip() for i in items if i.strip()]
                break
        except Exception:
            pass

    # Specs — tables first, then dt/dd
    specs = {}
    try:
        rows = await page.locator("table tr").all()
        for row in rows:
            cells = await row.locator("td").all()
            if len(cells) >= 2:
                key = (await cells[0].inner_text()).strip()
                val = (await cells[1].inner_text()).strip()
                if key:
                    specs[key] = val
    except Exception:
        pass

    if not specs:
        try:
            dts = await page.locator("dt").all_inner_texts()
            dds = await page.locator("dd").all_inner_texts()
            specs = {k.strip(): v.strip() for k, v in zip(dts, dds) if k.strip()}
        except Exception:
            pass

    # Score
    score = None
    try:
        score_text = await page.locator("[class*='corescore'], [class*='score']").first.inner_text()
        score = score_text.strip()
    except Exception:
        pass

    return {
        "model": model,
        "url": url,
        "score": score,
        "pros": pros,
        "cons": cons,
        "specs": specs,
    }


# -----------------------------
# Main
# -----------------------------
async def main():
    async with async_playwright() as p:
        browser = await p.chromium.launch(
            headless=True,
            args=[
                "--no-sandbox",
                "--disable-blink-features=AutomationControlled",
                "--disable-dev-shm-usage",
            ],
        )
        context = await browser.new_context(
            user_agent=(
                "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
                "AppleWebKit/537.36 (KHTML, like Gecko) "
                "Chrome/120.0.0.0 Safari/537.36"
            ),
            viewport={"width": 1280, "height": 800},
            locale="en-US",
        )
        await context.add_init_script(
            "Object.defineProperty(navigator, 'webdriver', {get: () => undefined})"
        )

        page = await context.new_page()

        print("=== Collecting shoe links ===")
        links = await get_all_links(page)
        print(f"\nTotal unique shoes found: {len(links)}")

        if not links:
            print("ERROR: No shoe links found.")
            print("Tip: Visit the catalog in a browser, right-click a shoe card → Inspect,")
            print("     check the <a> href pattern, and update is_shoe_url() to match.")
            await browser.close()
            return

        print("\n=== Scraping shoe pages ===")
        results = []
        errors = []

        for url in tqdm(links):
            try:
                data = await scrape_shoe(page, url)
                results.append(data)
                # Incremental save every 50 shoes so a crash doesn't lose everything
                if len(results) % 50 == 0:
                    with open("shoe-chatbot/runrepeat_shoes.json", "w") as f:
                        json.dump(results, f, indent=2)
                    print(f"  [checkpoint] {len(results)} saved")
            except Exception as e:
                errors.append({"url": url, "error": str(e)})

        await browser.close()

    if results:
        with open("shoe-chatbot/runrepeat_shoes.json", "w") as f:
            json.dump(results, f, indent=2)
        print(f"\n✅ Saved {len(results)} shoes to runrepeat_shoes.json")
    else:
        print("\n❌ No results collected.")

    if errors:
        print(f"⚠️  {len(errors)} pages failed:")
        for e in errors[:10]:
            print(f"  {e['url']}: {e['error']}")


asyncio.run(main())