import argparse
import asyncio
import json
import re
from pathlib import Path

import gradio as gr
from openai import AsyncOpenAI

from usage import print_usage, format_usage_markdown
from web_scrape import scrape_web

URL_RE = re.compile(r"(https?://[^\s]+)", re.IGNORECASE)

# OpenAI tool definition (schema) for local function calling
SCRAPE_WEB_TOOL = {
    "type": "function",
    "name": "scrape_web",
    "description": "Fetch and extract text content from a web page given a URL.",
    "parameters": {
        "type": "object",
        "properties": {
            "url": {
                "type": "string",
                "description": "The URL to scrape (must include http:// or https://).",
            }
        },
        "required": ["url"],
        "additionalProperties": False,
    },
}


def _normalize_urlish(text: str) -> str:
    """
    Normalize common malformed inputs like:
      - 'https:/example.com' -> 'https://example.com'
      - 'http:/example.com'  -> 'http://example.com'
    """
    t = (text or "").strip()
    if t.startswith("https:/") and not t.startswith("https://"):
        return "https://" + t[len("https:/") :]
    if t.startswith("http:/") and not t.startswith("http://"):
        return "http://" + t[len("http:/") :]
    return t


def _extract_first_url(text: str) -> str | None:
    m = URL_RE.search(text or "")
    if not m:
        return None
    return _normalize_urlish(m.group(1))


def _normalize_message_urls(user_message: str) -> str:
    """
    Replace the first URL found in the message with its normalized form
    (so 'https:/x.com' becomes 'https://x.com' inside the message).
    """
    original = URL_RE.search(user_message or "")
    if not original:
        return user_message
    raw_url = original.group(1)
    normalized = _normalize_urlish(raw_url)
    if normalized != raw_url:
        return user_message.replace(raw_url, normalized, 1)
    return user_message


class ChatAgent:
    def __init__(self, model: str, prompt: str):
        self._ai = AsyncOpenAI()
        self.usage = []
        self.model = model

        # Some models accept reasoning; keep it conditional but safe
        self.reasoning = {"effort": "low"} if "gpt-5" in self.model else None

        tool_instructions = (
            "You are a helpful assistant.\n"
            "You have access to a tool named scrape_web that can fetch and extract content from a webpage.\n"
            "Rules:\n"
            "- If the user asks what is on a website, to summarize a webpage, or to get content from a URL, call scrape_web.\n"
            "- If the user does not provide a URL, ask them to provide one.\n"
            "- After you get scrape_web results, summarize them and answer the user.\n"
        )

        self._history: list[dict] = []
        combined_prompt = tool_instructions + ("\n" + prompt if prompt else "")
        self._history.append({"role": "system", "content": combined_prompt})

    async def get_response(self, user_message: str):
        user_message = _normalize_message_urls(user_message or "")
        self._history.append({"role": "user", "content": user_message})

        # IMPORTANT: tools should be tool SCHEMAS, not a call to the python function.
        create_kwargs = {
            "input": self._history,
            "model": self.model,
            "tools": [SCRAPE_WEB_TOOL],
        }
        if self.reasoning is not None:
            create_kwargs["reasoning"] = self.reasoning

        response = await self._ai.responses.create(**create_kwargs)

        self.usage.append(response.usage)
        self._history.extend(response.output)

        response = await self._handle_tool_calls(response)
        return response.output_text

    async def _handle_tool_calls(self, response):
        """
        Execute any tool calls returned by the model, append tool outputs to history,
        then request the model's follow-up completion tied to previous_response_id.
        """
        tool_outputs = []
        prev_id = response.id

        for item in response.output:
            if getattr(item, "type", None) != "function_call":
                continue
            if getattr(item, "name", None) != "scrape_web":
                continue

            raw_args = getattr(item, "arguments", "") or ""
            try:
                args = json.loads(raw_args) if raw_args else {}
            except json.JSONDecodeError:
                args = {}

            # Optional: if model didn't provide a URL but user did, try to recover it
            if "url" not in args or not args["url"]:
                last_user = next(
                    (h for h in reversed(self._history) if h.get("role") == "user"), None
                )
                if last_user:
                    recovered = _extract_first_url(last_user.get("content", ""))
                    if recovered:
                        args["url"] = recovered

            # Execute your local python function
            try:
                scrape_result = scrape_web(**args)
            except TypeError as e:
                scrape_result = {
                    "content": None,
                    "error": f"Tool call arguments were invalid: {e}",
                }

            tool_outputs.append(
                {
                    "type": "function_call_output",
                    "call_id": item.call_id,
                    "output": json.dumps(scrape_result),
                }
            )

        if not tool_outputs:
            return response

        # Record tool outputs in history
        self._history.extend(tool_outputs)

        followup_kwargs = {
            "model": self.model,
            "previous_response_id": prev_id,
            "input": tool_outputs,
        }
        if self.reasoning is not None:
            followup_kwargs["reasoning"] = self.reasoning

        followup = await self._ai.responses.create(**followup_kwargs)

        self.usage.append(followup.usage)
        self._history.extend(followup.output)
        return followup

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc_val, exc_tb):
        print_usage(self.model, self.usage)


async def _main_console(agent: ChatAgent):
    while True:
        message = input("User: ")
        if not message:
            break
        response = await agent.get_response(message)
        print("Agent:", response)


def _main_gradio(agent: ChatAgent):
    css = """
    .gradio-container, .gradio-app, .gradio-root {
      width: 120ch;
      max-width: 120ch !important;
      margin-left: auto !important;
      margin-right: auto !important;
      box-sizing: border-box !important;
    }
    """

    usage_view = gr.Markdown(format_usage_markdown(agent.model, []))

    with gr.Blocks(css=css, theme=gr.themes.Monochrome()) as demo:

        async def get_response(message, chat_view_history):
            response = await agent.get_response(message)
            usage_content = format_usage_markdown(agent.model, agent.usage)
            return response, usage_content

        with gr.Row():
            with gr.Column(scale=5):
                bot = gr.Chatbot(label=" ", height=600, resizable=True)
                gr.ChatInterface(
                    chatbot=bot,
                    fn=get_response,
                    additional_outputs=[usage_view],
                )
            with gr.Column(scale=1):
                usage_view.render()

    demo.launch()


def main(prompt_path: Path | None, model: str, use_web: bool):
    prompt_text = prompt_path.read_text(encoding="utf-8") if prompt_path else ""
    with ChatAgent(model, prompt_text) as agent:
        if use_web:
            _main_gradio(agent)
        else:
            asyncio.run(_main_console(agent))


if __name__ == "__main__":
    parser = argparse.ArgumentParser("ChatBot")
    parser.add_argument("prompt_file", nargs="?", type=Path, default=None)
    parser.add_argument("--web", action="store_true")
    parser.add_argument("--model", default="gpt-5-nano")
    args = parser.parse_args()
    main(args.prompt_file, args.model, args.web)