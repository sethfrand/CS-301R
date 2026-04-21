"""
embed_shoes_openai.py
---------------------
Embeds shoe data using OpenAI text-embedding-3-large.

Usage:
    pip install chromadb openai tiktoken
    export OPENAI_API_KEY=sk-...
    python embed_shoes_openai.py

Fixes applied vs previous version:
  - Truncates documents to 8000 tokens before sending (model limit is 8192)
  - Resumes from last checkpoint so a crash doesn't restart from scratch
  - Smaller batch size (50) to avoid rate limit spikes
  - Accurate token counting via tiktoken instead of char // 4 estimate
"""

import json
import re
import os
import time
from pathlib import Path

import chromadb
from chromadb.utils import embedding_functions
import tiktoken

INPUT_FILE   = "shoe-chatbot/runrepeat_shoes.json"
CHROMA_DIR   = "./chroma_db_openai"
COLLECTION   = "running_shoes"
EMBED_MODEL  = "text-embedding-3-large"
BATCH_SIZE   = 50        # smaller batches = safer around rate limits
MAX_TOKENS   = 8000      # hard limit is 8192; keep a small buffer
PRICE_PER_1M = 0.13      # $/1M tokens for text-embedding-3-large

# cl100k_base is the tokenizer used by all text-embedding-3-* models
TOKENIZER = tiktoken.get_encoding("cl100k_base")


# -------------------------------------------------------------------
# Truncate a document to MAX_TOKENS if needed
# -------------------------------------------------------------------
def truncate(text: str, max_tokens: int = MAX_TOKENS) -> str:
    tokens = TOKENIZER.encode(text)
    if len(tokens) <= max_tokens:
        return text
    return TOKENIZER.decode(tokens[:max_tokens])


# -------------------------------------------------------------------
# Document builder
# -------------------------------------------------------------------
def build_document(shoe: dict) -> str:
    parts = []
    if shoe.get("model"):
        parts.append(f"Shoe: {shoe['model']}")
    if shoe.get("score"):
        parts.append(f"Expert score: {shoe['score']}")
    if shoe.get("pros"):
        parts.append("Pros: " + "; ".join(shoe["pros"]))
    if shoe.get("cons"):
        parts.append("Cons: " + "; ".join(shoe["cons"]))
    specs = shoe.get("specs") or {}
    if specs:
        parts.append("Specs — " + "; ".join(f"{k}: {v}" for k, v in specs.items() if k and v))
    lab = shoe.get("lab_results") or {}
    if lab:
        parts.append("Lab test results — " + "; ".join(f"{k}: {v}" for k, v in lab.items() if k and v))
    doc = "\n".join(parts)
    return truncate(doc)   # ← truncate before returning


# -------------------------------------------------------------------
# Metadata extractor
# -------------------------------------------------------------------
def extract_metadata(shoe: dict) -> dict:
    meta = {"model": shoe.get("model", ""), "url": shoe.get("url", "")}
    try:
        meta["score"] = float(re.search(r"[\d.]+", str(shoe.get("score") or "")).group())
    except Exception:
        pass
    all_data = {**(shoe.get("specs") or {}), **(shoe.get("lab_results") or {})}
    spec_map = {
        "weight": "weight", "weight (men)": "weight",
        "heel-to-toe drop": "drop_mm", "drop": "drop_mm",
        "stack height": "stack_height", "surface": "surface",
        "terrain": "terrain", "use": "use", "type": "type", "brand": "brand",
        "forefoot stack": "forefoot_stack_mm", "heel stack": "heel_stack_mm",
        "longitudinal bending stiffness": "bending_stiffness",
        "torsional stiffness": "torsional_stiffness",
    }
    for raw_key, meta_key in spec_map.items():
        for data_key, data_val in all_data.items():
            if raw_key in data_key.lower() and meta_key not in meta:
                meta[meta_key] = str(data_val).strip()
    if "brand" not in meta and meta.get("model"):
        meta["brand"] = meta["model"].split()[0].lower()
    if shoe.get("pros"):
        meta["pros"] = " | ".join(shoe["pros"])
    if shoe.get("cons"):
        meta["cons"] = " | ".join(shoe["cons"])
    return meta


# -------------------------------------------------------------------
# Main
# -------------------------------------------------------------------
def main():
    api_key = os.environ.get("OPENAI_API_KEY")
    if not api_key:
        raise EnvironmentError("OPENAI_API_KEY not set.\nRun: export OPENAI_API_KEY=sk-...")

    if not Path(INPUT_FILE).exists():
        raise FileNotFoundError(f"'{INPUT_FILE}' not found. Run the scraper first.")

    with open(INPUT_FILE) as f:
        shoes = json.load(f)

    shoes = [s for s in shoes if s.get("model") and s["model"] != "Running shoe reviews"]
    print(f"Loaded {len(shoes)} shoes")

    # Accurate token count + cost estimate using tiktoken
    docs = [build_document(s) for s in shoes]
    total_tokens = sum(len(TOKENIZER.encode(d)) for d in docs)
    est_cost = (total_tokens / 1_000_000) * PRICE_PER_1M

    # Report how many were truncated
    raw_docs = []
    for shoe in shoes:
        parts = []
        if shoe.get("model"):    parts.append(f"Shoe: {shoe['model']}")
        if shoe.get("score"):    parts.append(f"Expert score: {shoe['score']}")
        if shoe.get("pros"):     parts.append("Pros: " + "; ".join(shoe["pros"]))
        if shoe.get("cons"):     parts.append("Cons: " + "; ".join(shoe["cons"]))
        specs = shoe.get("specs") or {}
        if specs:                parts.append("Specs — " + "; ".join(f"{k}: {v}" for k, v in specs.items() if k and v))
        lab = shoe.get("lab_results") or {}
        if lab:                  parts.append("Lab test results — " + "; ".join(f"{k}: {v}" for k, v in lab.items() if k and v))
        raw_docs.append("\n".join(parts))

    truncated = sum(1 for r in raw_docs if len(TOKENIZER.encode(r)) > MAX_TOKENS)
    print(f"Total tokens (after truncation): {total_tokens:,}")
    print(f"Estimated cost ({EMBED_MODEL}): ~${est_cost:.4f}")
    print(f"Documents truncated: {truncated}/{len(shoes)}")
    confirm = input("Proceed? [y/N] ").strip().lower()
    if confirm != "y":
        print("Aborted.")
        return

    # Chroma setup
    ef = embedding_functions.OpenAIEmbeddingFunction(
        api_key=api_key,
        model_name=EMBED_MODEL,
    )
    client = chromadb.PersistentClient(path=CHROMA_DIR)

    # Check for existing collection to resume from
    already_done = 0
    try:
        existing = client.get_collection(name=COLLECTION, embedding_function=ef)
        already_done = existing.count()
        if already_done > 0:
            resume = input(f"Found {already_done} already embedded. Resume from there? [y/N] ").strip().lower()
            if resume != "y":
                client.delete_collection(COLLECTION)
                already_done = 0
                print("Restarting from scratch.")
            else:
                print(f"Resuming from shoe {already_done}...")
    except Exception:
        already_done = 0

    if already_done == 0:
        collection = client.create_collection(
            name=COLLECTION,
            embedding_function=ef,
            metadata={"hnsw:space": "cosine"},
        )
    else:
        collection = client.get_collection(name=COLLECTION, embedding_function=ef)

    # Embed in batches, starting after already-done records
    shoes_to_embed = shoes[already_done:]
    total = already_done

    for i in range(0, len(shoes_to_embed), BATCH_SIZE):
        batch     = shoes_to_embed[i : i + BATCH_SIZE]
        ids       = [f"shoe_{total + j}" for j, _ in enumerate(batch)]
        documents = [build_document(s) for s in batch]
        metadatas = [extract_metadata(s) for s in batch]

        try:
            collection.add(ids=ids, documents=documents, metadatas=metadatas)
            total += len(batch)
            print(f"  Embedded {total}/{len(shoes)} shoes...")
        except Exception as e:
            print(f"  ⚠️  Batch {i}–{i+len(batch)} failed: {e}")
            print("  Trying one at a time to isolate the bad record...")
            for j, (id_, doc, meta) in enumerate(zip(ids, documents, metadatas)):
                try:
                    collection.add(ids=[id_], documents=[doc], metadatas=[meta])
                    total += 1
                except Exception as e2:
                    print(f"    Skipped shoe_{total + j} ({meta.get('model', '?')}): {e2}")

        if i + BATCH_SIZE < len(shoes_to_embed):
            time.sleep(0.3)

    print(f"\n✅ Done. {total} shoes stored in '{CHROMA_DIR}' (collection: '{COLLECTION}')")


if __name__ == "__main__":
    main()