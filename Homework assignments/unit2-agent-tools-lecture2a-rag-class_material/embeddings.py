import os
import gradio as gr
import numpy as np
from openai import OpenAI
from sklearn.metrics.pairwise import cosine_similarity
import pandas as pd
try:
    import PyPDF2
    PDF_SUPPORT = True
except ImportError:
    PDF_SUPPORT = False

# Ensure API key exists
if not os.environ.get("OPENAI_API_KEY"):
    raise ValueError("OPENAI_API_KEY environment variable not set.")

# Initialize OpenAI client
client = OpenAI(api_key=os.environ.get("OPENAI_API_KEY"))

# Embedding pricing per 1M tokens (USD)
EMBEDDING_PRICING = {
    'text-embedding-3-small': 0.02,
    'text-embedding-3-large': 0.13,
    'text-embedding-ada-002': 0.10,
}

# Track usage across session
session_usage = {
    'total_tokens': 0,
    'total_cost': 0.0,
    'calls_by_model': {}
}


def get_embedding(text, model="text-embedding-3-small"):
    """Get embedding for a text string and track usage."""
    text = text.replace("\n", " ")
    response = client.embeddings.create(input=[text], model=model)

    # Track usage
    tokens = response.usage.total_tokens
    cost = (tokens / 1_000_000) * EMBEDDING_PRICING.get(model, 0)

    session_usage['total_tokens'] += tokens
    session_usage['total_cost'] += cost
    if model not in session_usage['calls_by_model']:
        session_usage['calls_by_model'][model] = {'tokens': 0, 'calls': 0, 'cost': 0.0}
    session_usage['calls_by_model'][model]['tokens'] += tokens
    session_usage['calls_by_model'][model]['calls'] += 1
    session_usage['calls_by_model'][model]['cost'] += cost

    return response.data[0].embedding


def chunk_text(text, chunk_size, overlap=0):
    """Split text into chunks of specified size with optional overlap."""
    words = text.split()
    chunks = []

    if chunk_size <= 0:
        return [text]

    step = max(1, chunk_size - overlap)

    for i in range(0, len(words), step):
        chunk = " ".join(words[i:i + chunk_size])
        if chunk:
            chunks.append(chunk)

    return chunks


def compute_similarity(text1, text2, model):
    """Compute cosine similarity between two text embeddings."""
    emb1 = get_embedding(text1, model)
    emb2 = get_embedding(text2, model)
    similarity = cosine_similarity([emb1], [emb2])[0][0]
    return f"Cosine Similarity: {similarity:.4f}"


def explore_chunks(text, chunk_size, overlap, model):
    """Chunk text and show embeddings info."""
    if not text.strip():
        return "Please enter some text to analyze.", None

    chunk_size = int(chunk_size)
    overlap = int(overlap)

    chunks = chunk_text(text, chunk_size, overlap)

    if len(chunks) == 0:
        return "No chunks created. Please adjust parameters.", None

    embeddings = [get_embedding(chunk, model) for chunk in chunks]

    summary = "**Text Analysis**\n\n"
    summary += f"- Total words: {len(text.split())}\n"
    summary += f"- Number of chunks: {len(chunks)}\n"
    summary += f"- Embedding dimension: {len(embeddings[0])}\n"
    summary += f"- Model: {model}\n\n"

    summary += "**Chunks:**\n\n"
    for i, chunk in enumerate(chunks):
        preview = chunk[:100] + ("..." if len(chunk) > 100 else "")
        summary += f"Chunk {i+1} ({len(chunk.split())} words):\n"
        summary += f"```\n{preview}\n```\n\n"

    if len(chunks) > 1:
        summary += "**Similarities Between Consecutive Chunks:**\n\n"
        for i in range(len(embeddings) - 1):
            sim = cosine_similarity([embeddings[i]], [embeddings[i+1]])[0][0]
            summary += f"- Chunk {i+1} -> Chunk {i+2}: {sim:.4f}\n"

    chunk_data = []
    for i, (chunk, emb) in enumerate(zip(chunks, embeddings)):
        chunk_data.append({
            "Chunk #": i + 1,
            "Words": len(chunk.split()),
            "Preview": chunk[:50] + ("..." if len(chunk) > 50 else ""),
            "Embedding Mean": f"{np.mean(emb):.4f}",
            "Embedding Std": f"{np.std(emb):.4f}"
        })

    df = pd.DataFrame(chunk_data)

    return summary, df


def read_file_content(file):
    """Read content from uploaded file (supports text and PDF files)."""
    if file is None:
        return ""

    try:
        # Check if it's a PDF file
        if file.name.lower().endswith('.pdf'):
            if not PDF_SUPPORT:
                return "Error: PDF support not available. Install PyPDF2: pip install PyPDF2"

            # Read PDF content
            with open(file.name, "rb") as f:
                pdf_reader = PyPDF2.PdfReader(f)
                text = ""
                for page in pdf_reader.pages:
                    text += page.extract_text() + "\n"
                return text.strip()
        else:
            # Read text file
            with open(file.name, "r", encoding="utf-8") as f:
                return f.read()
    except Exception as e:
        return f"Error reading file: {str(e)}"


def get_usage_stats():
    """Get current usage statistics."""
    if session_usage['total_tokens'] == 0:
        return "No API calls made yet. Start using the tools above!"

    stats = f"## 📊 Session Usage Statistics\n\n"
    stats += f"**Total Tokens**: {session_usage['total_tokens']:,}\n\n"
    stats += f"**Total Cost**: ${session_usage['total_cost']:.6f}\n\n"

    if session_usage['calls_by_model']:
        stats += "### Breakdown by Model\n\n"
        stats += "| Model | Calls | Tokens | Cost (USD) |\n"
        stats += "|-------|-------|--------|------------|\n"
        for model, data in session_usage['calls_by_model'].items():
            stats += f"| {model} | {data['calls']} | {data['tokens']:,} | ${data['cost']:.6f} |\n"

    return stats


def reset_usage():
    """Reset usage statistics."""
    session_usage['total_tokens'] = 0
    session_usage['total_cost'] = 0.0
    session_usage['calls_by_model'] = {}
    return "✅ Usage statistics reset!"


def semantic_search(query, documents, model, top_k, chunk_size, overlap, auto_chunk):
    """Perform semantic search on documents with optional auto-chunking."""
    if not query.strip() or not documents.strip():
        return "Please provide both a query and documents to search."

    top_k = int(top_k)

    doc_list = [doc.strip() for doc in documents.split("\n") if doc.strip()]

    if len(doc_list) == 0:
        return "No documents found. Please enter one document per line."

    # Apply chunking if enabled
    if auto_chunk:
        chunked_docs = []
        for doc in doc_list:
            # Only chunk if document is long enough
            if len(doc.split()) > chunk_size:
                chunks = chunk_text(doc, int(chunk_size), int(overlap))
                chunked_docs.extend(chunks)
            else:
                chunked_docs.append(doc)
        doc_list = chunked_docs

    query_emb = get_embedding(query, model)
    doc_embeddings = [get_embedding(doc, model) for doc in doc_list]

    similarities = []
    for i, doc_emb in enumerate(doc_embeddings):
        sim = cosine_similarity([query_emb], [doc_emb])[0][0]
        similarities.append((i, sim, doc_list[i]))

    similarities.sort(key=lambda x: x[1], reverse=True)

    results = "**Semantic Search Results**\n\n"
    results += f"Query: *{query}*\n\n"
    if auto_chunk:
        results += f"✂️ Documents auto-chunked ({chunk_size} words, {overlap} overlap)\n"
        results += f"📦 Total chunks searched: {len(doc_list)}\n\n"
    results += f"Top {min(top_k, len(similarities))} matches:\n\n"

    for rank, (idx, sim, doc) in enumerate(similarities[:top_k], 1):
        results += f"**{rank}. Chunk {idx+1}** (Similarity: {sim:.4f})\n"
        results += f"```\n{doc}\n```\n\n"

    return results


# -------------------------
# Gradio Interface
# -------------------------

with gr.Blocks(title="OpenAI Embeddings Playground", theme=gr.themes.Soft()) as demo:

    gr.Markdown("""
    # OpenAI Embeddings Playground

    Learn about and experiment with OpenAI embeddings.
    """)

    # -------------------------
    # Chunking Tab
    # -------------------------

    with gr.Tab("Text Chunking & Embeddings"):

        with gr.Row():
            with gr.Column():

                chunk_file_input = gr.File(
                    label="Upload File (optional)",
                    file_types=[".txt", ".md", ".py", ".json", ".csv", ".pdf"]
                )

                chunk_text_input = gr.Textbox(
                    label="Input Text",
                    lines=8,
                    value="Artificial intelligence is transforming the world. "
                          "Machine learning models can now understand and generate human-like text."
                )

                chunk_file_input.change(
                    fn=read_file_content,
                    inputs=chunk_file_input,
                    outputs=chunk_text_input
                )

                chunk_size_input = gr.Slider(5, 100, value=20, step=5, label="Chunk Size (words)")
                overlap_input = gr.Slider(0, 20, value=5, step=1, label="Overlap (words)")

                chunk_model_input = gr.Dropdown(
                    choices=["text-embedding-3-small", "text-embedding-3-large"],
                    value="text-embedding-3-small",
                    label="Embedding Model"
                )

                chunk_btn = gr.Button("Analyze Chunks", variant="primary")

            with gr.Column():
                chunk_output = gr.Markdown()
                chunk_table = gr.Dataframe()

        chunk_btn.click(
            fn=explore_chunks,
            inputs=[chunk_text_input, chunk_size_input, overlap_input, chunk_model_input],
            outputs=[chunk_output, chunk_table]
        )

    # -------------------------
    # Semantic Search Tab
    # -------------------------

    with gr.Tab("Semantic Search"):
        gr.Markdown("""
        ### Semantic Search with Auto-Chunking
        Upload a document or paste text. Long documents are automatically split into chunks for better search results.
        """)

        with gr.Row():
            with gr.Column():

                search_query = gr.Textbox(
                    label="Search Query",
                    placeholder="What are you looking for?",
                    value="machine learning algorithms"
                )
                search_file_input = gr.File(
                    label="Upload Document File (optional)",
                    file_types=[".txt", ".md", ".py", ".json", ".csv", ".pdf"]
                )
                search_docs = gr.Textbox(
                    label="Documents (one per line, or upload a file above)",
                    placeholder="Enter documents or upload a file...",
                    lines=8,
                    value="Deep learning uses neural networks with multiple layers.\nPython is a popular programming language.\nNeural networks are inspired by the human brain.\nDatabases store and organize data.\nMachine learning algorithms learn from data patterns.\nThe weather today is sunny and warm."
                )

                # File upload handler
                search_file_input.change(
                    fn=read_file_content,
                    inputs=search_file_input,
                    outputs=search_docs
                )

                search_model = gr.Dropdown(
                    choices=["text-embedding-3-small", "text-embedding-3-large"],
                    value="text-embedding-3-small",
                    label="Embedding Model"
                )

                top_k = gr.Slider(1, 10, value=3, step=1, label="Number of Results")

                # Chunking controls
                with gr.Accordion("⚙️ Auto-Chunking Settings", open=False):
                    auto_chunk = gr.Checkbox(
                        label="Enable Auto-Chunking",
                        value=True,
                        info="Automatically split long documents into chunks for better search"
                    )
                    search_chunk_size = gr.Slider(
                        minimum=20,
                        maximum=200,
                        value=100,
                        step=10,
                        label="Chunk Size (words)"
                    )
                    search_overlap = gr.Slider(
                        minimum=0,
                        maximum=50,
                        value=10,
                        step=5,
                        label="Overlap (words)"
                    )

                search_btn = gr.Button("Search", variant="primary")

            with gr.Column():
                search_output = gr.Markdown()

        search_btn.click(
            fn=semantic_search,
            inputs=[search_query, search_docs, search_model, top_k, search_chunk_size, search_overlap, auto_chunk],
            outputs=search_output
        )

    # -------------------------
    # Similarity Tab
    # -------------------------

    with gr.Tab("Similarity Comparison"):

        with gr.Row():
            with gr.Column():

                sim_text1 = gr.Textbox(label="Text 1", lines=4)
                sim_text2 = gr.Textbox(label="Text 2", lines=4)

                sim_model = gr.Dropdown(
                    choices=["text-embedding-3-small", "text-embedding-3-large"],
                    value="text-embedding-3-small",
                    label="Embedding Model"
                )

                compare_btn = gr.Button("Compare", variant="primary")

            with gr.Column():
                similarity_output = gr.Textbox(label="Similarity Score")

        compare_btn.click(
            fn=compute_similarity,
            inputs=[sim_text1, sim_text2, sim_model],
            outputs=similarity_output)

    with gr.Tab("💰 Usage & Costs"):
        gr.Markdown("""
        ### API Usage Tracking
        Monitor your OpenAI API token usage and costs in real-time.
        """)

        with gr.Row():
            with gr.Column():
                refresh_btn = gr.Button("🔄 Refresh Stats", variant="primary")
                reset_btn = gr.Button("🗑️ Reset Statistics", variant="stop")

            with gr.Column():
                usage_output = gr.Markdown(value=get_usage_stats())
                reset_output = gr.Textbox(label="Status", visible=False)

        refresh_btn.click(
            fn=get_usage_stats,
            inputs=[],
            outputs=usage_output
        )

        reset_btn.click(
            fn=reset_usage,
            inputs=[],
            outputs=reset_output
        ).then(
            fn=get_usage_stats,
            inputs=[],
            outputs=usage_output
        )

        gr.Markdown("""
        ---
        ### 📌 Pricing Information (per 1M tokens)
        - **text-embedding-3-small**: $0.02
        - **text-embedding-3-large**: $0.13
        - **text-embedding-ada-002**: $0.10

        Usage statistics are tracked for the current session only and will reset when you restart the app.
        """)

    gr.Markdown("""
    ---
    ### 💡 Tips:
    - **Auto-Chunking**: Enable in Semantic Search to automatically split long documents for better search precision
    - **Chunk Size**: Larger chunks (100-200 words) preserve more context; smaller chunks (20-50 words) are more precise
    - **Overlap**: Helps maintain context across chunk boundaries (10-20% of chunk size recommended)
    - **File Uploads**: Supports .txt, .md, .py, .json, .csv, and .pdf files
    - **Models**:
        - `text-embedding-3-small`: Fast, 1536 dimensions, most cost-effective
        - `text-embedding-3-large`: More accurate, 3072 dimensions, higher cost
        - `text-embedding-ada-002`: Legacy model, 1536 dimensions
    - **Cosine Similarity**: Ranges from -1 to 1 (higher = more similar)
    - **Best Practice**: Upload PDFs with auto-chunking enabled for optimal semantic search on long documents
    """)


if __name__ == "__main__":
    demo.launch()