import requests
from bs4 import BeautifulSoup

web_scrape = {
    "type": "function",
    "name": "web_scrape",
    "description": "Scrape text content from a web URL",
    "strict": True,
    "parameters": {
        "type": "object",
        "properties": {
            "url": {
                "type": "string",
                "description": "web url, e.g., 'https://www.bbc.com/news'",
            },
        },
        "required": ["url"],
        "additionalProperties": False,
    },
}

def scrape_web(url: str) -> dict:
    """Fetch and extract text content from a web page.

    Args:
        url: The URL to scrape

    Returns:
        dict with 'content' (text) and 'error' (if any)
    """
    try:
        response = requests.get(url, timeout=10)
        response.raise_for_status()

        soup = BeautifulSoup(response.text, 'html.parser')

        # Remove script and style elements
        for script in soup(["script", "style"]):
            script.decompose()

        # Get text and clean it up
        text = soup.get_text()
        lines = (line.strip() for line in text.splitlines())
        chunks = (phrase.strip() for line in lines for phrase in line.split("  "))
        text = '\n'.join(chunk for chunk in chunks if chunk)

        return {"content": text, "error": None}

    except Exception as e:
        return {"content": None, "error": str(e)}
