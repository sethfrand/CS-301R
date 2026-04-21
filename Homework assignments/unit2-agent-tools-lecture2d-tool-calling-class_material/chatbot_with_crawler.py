import argparse
import asyncio
import json
from pathlib import Path

import gradio as gr
from openai import AsyncOpenAI

from usage import print_usage, format_usage_markdown
from crawler import scrape_web

# --------------------
# Tool schema
# --------------------
TOOLS = [
    {
        "name": "scrape_web",
        "schema": {
            "type": "function",
            "name": "scrape_web",
            "description": (
                "Search General Conference talks for an exact quote given a paraphrase "
                "and speaker name. Returns the exact quote, talk title, and source URL."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "query": {
                        "type": "string",
                        "description": "The paraphrased or partial quote to search for.",
                    },
                    "speaker": {
                        "type": "string",
                        "description": "Full name of the General Conference speaker.",
                    },
                    "url": {
                        "type": "string",
                        "description": "Optional direct URL to a specific talk page.",
                    },
                },
                "required": ["query", "speaker"],
            },
        },
        "function": scrape_web,
    }
]

# --------------------
# Agent
# --------------------
class ChatAgent:
    def __init__(self, model: str, prompt: str):
        self._ai = AsyncOpenAI()
        self.model = model
        self.history: list[dict] = []
        self.usages: list = []
        self.tool_map = {t["name"]: t["function"] for t in TOOLS}

        instructions = (
            "You are a General Conference quote finder.\n"
            "You have access to a tool called scrape_web that searches LDS General Conference talks.\n"
            "\n"
            "Rules:\n"
            "1. Before calling the tool, make sure you have BOTH:\n"
            "   - A paraphrased or partial quote from the user.\n"
            "   - The speaker's full name.\n"
            "   If either is missing, ask the user for it before proceeding.\n"
            "2. Call scrape_web with both `query` (the paraphrase) and `speaker` (full name).\n"
            "3. After receiving results:\n"
            "   - If found: present the EXACT quote, the talk title, and the source URL.\n"
            "   - If not found: tell the user and ask if they want to try different wording "
            "     or a different speaker name.\n"
            "4. Never fabricate or paraphrase quotes — always use the exact text returned by the tool.\n"
        )
        combined_prompt = instructions + ("\n\n" + prompt if prompt else "")
        self.history.append({"role": "system", "content": combined_prompt})

    # --------------------
    # Main interface
    # --------------------
    async def get_response(self, user_message: str) -> str:
        self.history.append({"role": "user", "content": user_message})
        response = await self._call_model()

        while response.get("tool_calls"):
            response = await self._handle_tool_calls(response)

        return response.get("content", "")

    async def _call_model(self) -> dict:
        resp = await self._ai.responses.create(
            model=self.model,
            input=self.history,
            tools=[t["schema"] for t in TOOLS],
        )
        return self._normalize_response(resp)

    def _normalize_response(self, resp) -> dict:
        """Convert SDK response to a plain dict + append relevant items to history."""
        if hasattr(resp, "usage") and resp.usage is not None:
            self.usages.append(resp.usage)
        text_output = ""
        tool_calls = []

        for item in resp.output:
            if item.type == "message":
                for c in item.content:
                    if c.type == "output_text":
                        text_output += c.text
            elif item.type == "function_call":
                self.history.append(
                    {
                        "type": "function_call",
                        "call_id": item.call_id,   # must be call_id, not id
                        "name": item.name,
                        "arguments": item.arguments or "{}",
                    }
                )
                tool_calls.append(
                    {
                        "id": item.call_id,         # matched by function_call_output below
                        "name": item.name,
                        "arguments": json.loads(item.arguments) if item.arguments else {},
                    }
                )

        text_output = text_output.strip()
        if text_output:
            self.history.append({"role": "assistant", "content": text_output})

        return {
            "role": "assistant",
            "content": text_output,
            "tool_calls": tool_calls or None,
        }

    async def _handle_tool_calls(self, response: dict) -> dict:
        for call in (response.get("tool_calls") or []):
            tool_name = call["name"]
            args = call.get("arguments", {})

            tool_fn = self.tool_map.get(tool_name)
            if tool_fn is None:
                result = json.dumps({"error": f"Unknown tool: {tool_name}"})
            else:
                # scrape_web is sync but uses Playwright internally via asyncio.
                # Run it in a thread pool so it doesn't block the event loop.
                loop = asyncio.get_event_loop()
                raw = await loop.run_in_executor(None, lambda: tool_fn(**args))
                result = raw if isinstance(raw, str) else json.dumps(raw)

            self.history.append(
                {
                    "type": "function_call_output",
                    "call_id": call["id"],
                    "output": result,
                }
            )

        return await self._call_model()

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc_val, exc_tb):
        print_usage(self.model, self.usages)


# --------------------
# Console / Gradio entrypoints
# --------------------
async def _main_console(agent: ChatAgent):
    print("General Conference Quote Finder — type your message, blank line to quit.\n")
    while True:
        message = input("User: ").strip()
        if not message:
            break
        response = await agent.get_response(message)
        print(f"Agent: {response}\n")


def _main_gradio(agent: ChatAgent):
    css = """
    .gradio-container, .gradio-app, .gradio-root {
        width: 120ch; max-width: 120ch !important;
        margin-left: auto !important;
        margin-right: auto !important;
    }
    """
    usage_view = gr.Markdown(format_usage_markdown(agent.model, agent.usages))

    with gr.Blocks(css=css, theme=gr.themes.Monochrome()) as demo:

        async def get_response(message, chat_view_history):
            response = await agent.get_response(message)
            usage_content = format_usage_markdown(agent.model, agent.usages)
            return response, usage_content

        with gr.Row():
            with gr.Column(scale=5):
                bot = gr.Chatbot(
                    label="General Conference Quote Finder",
                    height=600,
                    resizable=True,
                )
                gr.ChatInterface(
                    chatbot=bot,
                    fn=get_response,
                    additional_outputs=[usage_view],
                    examples=[
                        ["Russell M. Nelson said something about joy being more than happiness"],
                        ["Dieter Uchtdorf spoke about grace and the Atonement"],
                        ["Jeffrey Holland quoted something about faith and doubt"],
                    ],
                )
            with gr.Column(scale=1):
                usage_view.render()

    demo.launch()


# --------------------
# Main
# --------------------
def main(prompt_file: Path | None, model: str, use_web: bool):
    prompt_text = prompt_file.read_text(encoding="utf-8") if prompt_file else ""
    with ChatAgent(model, prompt_text) as agent:
        if use_web:
            _main_gradio(agent)
        else:
            asyncio.run(_main_console(agent))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="General Conference Quote Finder")
    parser.add_argument("prompt_file", nargs="?", type=Path, default=None,
                        help="Optional path to a system prompt .txt file")
    parser.add_argument("--web", action="store_true",
                        help="Launch Gradio web UI instead of console")
    parser.add_argument("--model", default="gpt-4o-mini",
                        help="OpenAI model to use (default: gpt-4o-mini)")
    args = parser.parse_args()
    main(args.prompt_file, args.model, args.web)