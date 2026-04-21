# Before running this script:
# pip install gradio openai mcp

import argparse
import asyncio
import json
import sys
from pathlib import Path

import gradio as gr
from openai import AsyncOpenAI
from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client

from tools import ToolBox
from usage import print_usage, format_usage_markdown

# Path to the built markdownify-mcp server
MCP_COMMAND = "node"
MCP_ARGS = ["/Users/sethfrandsen/Desktop/school/Winter-2026/301R-Agent_Engineering/Homework assignments/unit2-agent-tools-lecture2f-mcp-and-alternatives-class_material/markdownify-mcp/dist/index.js"]


class MCPClient:
    def __init__(self, command: str, args: list[str]):
        self.server_params = StdioServerParameters(command=command, args=args)
        self._session: ClientSession | None = None
        self._ready = asyncio.Event()
        self._task: asyncio.Task | None = None
        self._stop_event = asyncio.Event()

    async def _run(self):
        async with stdio_client(self.server_params) as (read, write):
            async with ClientSession(read, write) as session:
                await session.initialize()
                self._session = session
                self._ready.set()
                await self._stop_event.wait()

    async def start(self):
        self._task = asyncio.create_task(self._run())
        await self._ready.wait()

    async def stop(self):
        self._stop_event.set()
        if self._task:
            self._task.cancel()
            try:
                await self._task
            except (asyncio.CancelledError, Exception):
                pass

    async def get_openai_tools(self) -> list:
        result = await self._session.list_tools()
        return [{
            "type": "function",
            "name": tool.name,
            "description": tool.description,
            "parameters": tool.inputSchema,
        } for tool in result.tools]

    async def call_tool(self, name: str, arguments: dict) -> str:
        result = await self._session.call_tool(name, arguments)
        return "\n".join(
            block.text for block in result.content if hasattr(block, "text")
        )


class ChatAgent:
    def __init__(self, model: str, prompt: str, show_reasoning: bool, reasoning_effort: str | None):
        self._ai = AsyncOpenAI()
        self.model = model
        self.show_reasoning = show_reasoning
        self.reasoning = {}
        if show_reasoning:
            self.reasoning['summary'] = 'auto'
        if 'gpt-5' in self.model and reasoning_effort:
            self.reasoning['effort'] = reasoning_effort

        self.usage = []
        self.usage_markdown = format_usage_markdown(self.model, [])

        self._history = []
        self._prompt = prompt
        if prompt:
            self._history.append({'role': 'system', 'content': prompt})

        self._local_tools = ToolBox()
        self._mcp: MCPClient | None = None
        self._all_tools: list = []

    async def setup(self):
        """Start MCP server and build combined tool list."""
        self._mcp = MCPClient(MCP_COMMAND, MCP_ARGS)
        await self._mcp.start()
        mcp_tools = await self._mcp.get_openai_tools()
        self._all_tools = self._local_tools.tools + mcp_tools
        print(f"Loaded {len(mcp_tools)} MCP tools: {[t['name'] for t in mcp_tools]}")

    async def teardown(self):
        if self._mcp:
            await self._mcp.stop()

    async def get_response(self, user_message: str):
        self._history.append({'role': 'user', 'content': user_message})

        while True:
            response = await self._ai.responses.create(
                input=self._history,
                model=self.model,
                reasoning=self.reasoning,
                tools=self._all_tools,
            )

            self.usage.append(response.usage)
            self.usage_markdown = format_usage_markdown(self.model, self.usage)
            self._history.extend(response.output)

            for item in response.output:
                if item.type == 'reasoning':
                    for chunk in item.summary:
                        yield 'reasoning', chunk.text

                elif item.type == 'function_call':
                    yield 'reasoning', f'{item.name}({item.arguments})'

                    args = json.loads(item.arguments)

                    # Try local tools first, fall back to MCP
                    local_func = self._local_tools.get_tool_function(item.name)
                    if local_func:
                        result = local_func(**args)
                    elif self._mcp:
                        result = await self._mcp.call_tool(item.name, args)
                    else:
                        result = f"Error: no handler found for tool '{item.name}'"

                    self._history.append({
                        'type': 'function_call_output',
                        'call_id': item.call_id,
                        'output': str(result)
                    })
                    yield 'reasoning', str(result)

                elif item.type == 'message':
                    for chunk in item.content:
                        yield 'output', chunk.text
                    return

    def print_usage(self):
        print_usage(self.model, self.usage)


async def _main_console(agent_args):
    agent = ChatAgent(**agent_args)
    await agent.setup()
    try:
        while True:
            message = input('User: ')
            if not message:
                break

            reasoning_complete = True
            if agent.show_reasoning:
                print(' Reasoning '.center(30, '-'))
                reasoning_complete = False

            last_type = ''
            async for text_type, text in agent.get_response(message):
                if text_type == 'output' and not reasoning_complete:
                    print()
                    print('-' * 30)
                    print()
                    print('Agent: ')
                    reasoning_complete = True

                if last_type != text_type:
                    print(f'\n{text_type}: ', end='', flush=True)
                    last_type = text_type

                print(text, end='', flush=True)
            print()
            print()
    finally:
        agent.print_usage()
        await agent.teardown()


def _main_gradio(agent_args):
    css = """
    .gradio-container, .gradio-app, .gradio-root {
      width: 120ch;
      max-width: 120ch !important;
      margin-left: auto !important;
      margin-right: auto !important;
      box-sizing: border-box !important;
    }

    #reasoning-md {
        max-height: 300px;
        overflow-y: auto;
    }
    """

    reasoning_view = gr.Markdown('', elem_id='reasoning-md')
    usage_view = gr.Markdown('')

    with gr.Blocks(css=css, theme=gr.themes.Monochrome()) as demo:
        agent_state = gr.State()

        async def get_response(message, chat_view_history, agent):
            output = ""
            reasoning = ""

            async for text_type, text in agent.get_response(message):
                if text_type == 'reasoning':
                    reasoning += text
                elif text_type == 'output':
                    output += text
                else:
                    raise NotImplementedError(text_type)

                yield output, reasoning, agent.usage_markdown, agent

            yield output, reasoning, agent.usage_markdown, agent

        async def create_agent():
            agent = ChatAgent(**agent_args)
            await agent.setup()
            return agent

        with gr.Row():
            with gr.Column(scale=5):
                bot = gr.Chatbot(
                    label=' ',
                    height=600,
                    resizable=True,
                )
                chat = gr.ChatInterface(
                    chatbot=bot,
                    fn=get_response,
                    additional_inputs=[agent_state],
                    additional_outputs=[reasoning_view, usage_view, agent_state]
                )

            with gr.Column(scale=1):
                reasoning_view.render()
                usage_view.render()

        demo.load(fn=create_agent, outputs=[agent_state])

    demo.launch()


def main(prompt_path: Path, model: str, show_reasoning, reasoning_effort: str | None, use_web: bool):
    agent_args = dict(
        model=model,
        prompt=prompt_path.read_text() if prompt_path else '',
        show_reasoning=show_reasoning,
        reasoning_effort=reasoning_effort,
    )

    if use_web:
        _main_gradio(agent_args)
    else:
        asyncio.run(_main_console(agent_args))


# Launch app
if __name__ == "__main__":
    parser = argparse.ArgumentParser('ChatBot')
    parser.add_argument('prompt_file', nargs='?', type=Path, default=None)
    parser.add_argument('--web', action='store_true')
    parser.add_argument('--model', default='gpt-5-nano')
    parser.add_argument('--show-reasoning', action='store_true')
    parser.add_argument('--reasoning-effort', default='low')
    args = parser.parse_args()
    main(args.prompt_file, args.model, args.show_reasoning, args.reasoning_effort, args.web)