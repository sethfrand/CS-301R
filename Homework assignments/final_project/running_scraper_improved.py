import asyncio
import re
import json
import pandas as pd
from tqdm import tqdm
from playwright.async_api import async_playwright

CATALOG = "https://runrepeat.com/catalog/running-shoes"

SHOE_URL_RE = re.compile(r"^https://runrepeat\.com/[a-z0-9][a-z0-9-]+$")

def is_shoe_url(href):
    return bool(SHOE_URL_RE.match(href))


# -----------------------------
# Collect links across all pages
# -----------------------------
async def get_all_links(page):
    all_links = set()

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
# Parse all tables on the page robustly
# Returns a flat dict of {label: value}
# Handles: th/td rows, td label+value rows, multi-column comparison tables
# -----------------------------
async def parse_all_tables(page) -> dict:
    """
    Extracts all tables from the page into a single flat dict.

    Handles three common structures:
      1. <tr><th>Label</th><td>Value</td></tr>          ← standard spec table
      2. <tr><td>Label</td><td>Val1</td><td>Val2</td></tr>  ← comparison (takes first shoe col)
      3. Labeled sections (reads nearest heading as section prefix)
    """
    result = {}

    # Get all tables with their preceding heading for context
    tables_data = await page.evaluate("""
        () => {
            const out = [];
            document.querySelectorAll('table').forEach(table => {
                // Find the nearest preceding heading to use as section label
                let section = '';
                let el = table;
                while (el && el !== document.body) {
                    el = el.previousElementSibling || el.parentElement;
                    if (el) {
                        const h = el.querySelector('h2,h3,h4') || (el.matches('h2,h3,h4') ? el : null);
                        if (h) { section = h.innerText.trim(); break; }
                    }
                }

                const rows = [];
                table.querySelectorAll('tr').forEach(tr => {
                    const cells = [];
                    tr.querySelectorAll('th, td').forEach(cell => {
                        cells.push({
                            tag:  cell.tagName.toLowerCase(),
                            text: cell.innerText.trim(),
                            cls:  cell.className || ''
                        });
                    });
                    if (cells.length > 0) rows.push(cells);
                });

                if (rows.length > 0) out.push({ section, rows });
            });
            return out;
        }
    """)

    for table in tables_data:
        section = table["section"]
        prefix  = f"{section} — " if section else ""

        # Read the header row to get column names (if any)
        col_headers = []
        rows = table["rows"]

        for row in rows:
            cells = row

            # Case 1: first cell is <th> → it's a row label
            if cells[0]["tag"] == "th" and len(cells) >= 2:
                label = cells[0]["text"]
                value = cells[1]["text"]
                if label:
                    result[f"{prefix}{label}"] = value

            # Case 2: all <td> — figure out if col[0] is a label or a value
            elif all(c["tag"] == "td" for c in cells):
                if len(cells) == 2:
                    # Two-column: treat as label → value
                    label, value = cells[0]["text"], cells[1]["text"]
                    if label:
                        result[f"{prefix}{label}"] = value

                elif len(cells) >= 3:
                    # Three+ columns: first column is the row label,
                    # second column is this shoe's value (first comparison target)
                    label = cells[0]["text"]
                    value = cells[1]["text"]
                    # Only store if label looks like a real label (not a measurement)
                    if label and not re.match(r'^[\d\.\-\+]+', label):
                        result[f"{prefix}{label}"] = value

    return result


# -----------------------------
# Parse the dedicated Lab Test Results section
# -----------------------------
async def parse_lab_results(page) -> dict:
    """
    Lab results are typically in a structured section with measurement rows.
    Each row: label in one element, value in another.
    We target the section by heading text.
    """
    lab_data = await page.evaluate("""
        () => {
            const results = {};

            // Find any element whose text contains 'Lab test'
            const headings = Array.from(document.querySelectorAll('h2,h3,h4,h5,[class*="title"],[class*="heading"]'));
            const labHeading = headings.find(h => /lab.?test/i.test(h.innerText));
            if (!labHeading) return results;

            // Walk siblings/children after the heading to find measurement rows
            // Collect the parent section container
            const container = labHeading.closest('section') ||
                              labHeading.closest('[class*="lab"]') ||
                              labHeading.parentElement;

            if (!container) return results;

            // Grab all rows that look like label+value pairs
            // Pattern A: explicit row elements with label/value children
            container.querySelectorAll('[class*="row"],[class*="item"],[class*="stat"],[class*="metric"]').forEach(row => {
                const children = Array.from(row.children);
                if (children.length >= 2) {
                    const label = children[0].innerText.trim();
                    const value = children[1].innerText.trim();
                    if (label && value) results[label] = value;
                }
            });

            // Pattern B: table rows within the lab section
            container.querySelectorAll('tr').forEach(tr => {
                const cells = Array.from(tr.querySelectorAll('th,td'));
                if (cells.length >= 2) {
                    const label = cells[0].innerText.trim();
                    const value = cells[1].innerText.trim();
                    if (label && !/^\\d+\\.?\\d*$/.test(label)) {
                        results[label] = value;
                    }
                }
            });

            // Pattern C: dl/dt/dd pairs
            container.querySelectorAll('dt').forEach(dt => {
                const dd = dt.nextElementSibling;
                if (dd && dd.tagName === 'DD') {
                    results[dt.innerText.trim()] = dd.innerText.trim();
                }
            });

            return results;
        }
    """)
    return lab_data


# -----------------------------
# Extract shoe page data
# -----------------------------
async def scrape_shoe(page, url):
    await page.goto(url, wait_until="domcontentloaded", timeout=30000)
    await page.wait_for_timeout(1500)

    # Scroll to trigger lazy-loaded sections (including lab results)
    for _ in range(6):
        await page.evaluate("window.scrollBy(0, 1200)")
        await page.wait_for_timeout(300)

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

    # All table-based specs (now with proper labels)
    specs = await parse_all_tables(page)

    # Lab test results (dedicated section)
    lab_results = await parse_lab_results(page)

    # Score
    score = None
    try:
        score_text = await page.locator("[class*='corescore'], [class*='score']").first.inner_text()
        score = score_text.strip()
    except Exception:
        pass

    return {
        "model":       model,
        "url":         url,
        "score":       score,
        "pros":        pros,
        "cons":        cons,
        "specs":       specs,
        "lab_results": lab_results,
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
            await browser.close()
            return

        print("\n=== Scraping shoe pages ===")
        results = []
        errors  = []

        for url in tqdm(links):
            try:
                data = await scrape_shoe(page, url)
                results.append(data)
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