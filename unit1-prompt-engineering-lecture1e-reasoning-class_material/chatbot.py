# Before running this script:
# pip install gradio openai

import argparse
import asyncio
from pathlib import Path
from datetime import datetime

import gradio as gr
from openai import AsyncOpenAI

from usage import print_usage, format_usage_markdown


class ChatAgent:
    def __init__(self, model: str, prompt: str, show_reasoning: bool, reasoning_effort: str | None, log_file: str | None = None):
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
        self.reasoning_effort = reasoning_effort

        self._history = []
        self._prompt = prompt
        if prompt:
            self._history.append({'role': 'system', 'content': prompt})

        self.log_file = log_file
        if log_file:
            with open(log_file, 'w') as f:
                f.write(f"Chat Log - {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}\n")
                f.write(f"Model: {model}\n")
                f.write(f"Reasoning Effort: {reasoning_effort if reasoning_effort else 'N/A'}\n")
                f.write(f"System Prompt: {prompt if prompt else 'None'}\n")
                f.write("="*80 + "\n\n")

    async def get_response(self, user_message: str):
        self._history.append({'role': 'user', 'content': user_message})

        if self.log_file:
            with open(self.log_file, 'a') as f:
                f.write(f"User: {user_message}\n\n")

        stream = self._ai.responses.stream(
            input=self._history,
            model=self.model,
            reasoning=self.reasoning,
        )

        full_output = ""
        full_reasoning = ""
        async with stream as stream:
            async for event in stream:
                if event.type == "response.output_text.delta":
                    full_output += event.delta
                    yield 'output', event.delta

                if event.type == "response.reasoning_summary_text.delta":
                    full_reasoning += event.delta
                    yield 'reasoning', event.delta

            response = await stream.get_final_response()
            self.usage.append(response.usage)
            self.usage_markdown = format_usage_markdown(self.model, self.usage)
            self._history.extend(
                response.output
            )

            if self.log_file:
                with open(self.log_file, 'a') as f:
                    if full_reasoning:
                        f.write(f"Reasoning: {full_reasoning}\n\n")
                    f.write(f"Assistant: {full_output}\n\n")
                    f.write("-" * 80 + "\n")
                    f.write(f"Usage for this response:\n")
                    f.write(f"  Input tokens: {response.usage.input_tokens}\n")
                    f.write(f"  Cached tokens: {response.usage.input_tokens_details.cached_tokens}\n")
                    f.write(f"  Output tokens: {response.usage.output_tokens}\n")
                    f.write(f"  Reasoning tokens: {response.usage.output_tokens_details.reasoning_tokens}\n")

                    from usage import _aggregate_usage, _calculate_cost_usd
                    total = _aggregate_usage(self.usage)
                    cost = _calculate_cost_usd(self.model, total)
                    f.write(f"\nCumulative Usage:\n")
                    f.write(f"  Total input tokens: {total['input']}\n")
                    f.write(f"  Total cached tokens: {total['cached']}\n")
                    f.write(f"  Total output tokens: {total['output']}\n")
                    f.write(f"  Total reasoning tokens: {total['reasoning']}\n")
                    f.write(f"  Total cost: ${cost:.6f}\n")
                    f.write("="*80 + "\n\n")

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc_val, exc_tb):
        print_usage(self.model, self.usage)


async def _main_console(agent_args):
    with ChatAgent(**agent_args) as agent:
        while True:
            message = input('User: ')
            if not message:
                break

            reasoning_complete = True
            if agent.show_reasoning:
                print(' Reasoning '.center(30, '-'))
                reasoning_complete = False

            async for text_type, text in agent.get_response(message):
                if text_type == 'output' and not reasoning_complete:
                    print()
                    print('-' * 30)
                    print()
                    print('Agent: ')
                    reasoning_complete = True

                print(text, end='', flush=True)
            print()
            print()


def _main_gradio(agent_args):
    # Constrain width with CSS and center
    css = """
    /* limit overall Gradio app width and center it */
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
        agent = gr.State()

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

        def update_model(model_name, current_agent):
            # Create new agent with updated model
            new_agent_args = agent_args.copy()
            new_agent_args['model'] = model_name
            # Generate new log file name with timestamp
            timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
            new_agent_args['log_file'] = f"chat_log_{model_name}_{timestamp}.txt"
            return ChatAgent(**new_agent_args)

        with gr.Row():
            with gr.Column(scale=5):
                model_dropdown = gr.Dropdown(
                    choices=['gpt-5-nano', 'gpt-5-mini', 'gpt-5', 'gpt-4o', 'gpt-4o-mini'],
                    value=agent_args['model'],
                    label='Model',
                    interactive=True
                )
                bot = gr.Chatbot(
                    label=' ',
                    height=600,
                    resizable=True,
                )
                chat = gr.ChatInterface(
                    chatbot=bot,
                    fn=get_response,
                    additional_inputs=[agent],
                    additional_outputs=[reasoning_view, usage_view, agent]
                )

            with gr.Column(scale=1):
                reasoning_view.render()
                usage_view.render()

        def init_agent():
            # Generate log file name with timestamp on initial load
            timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
            init_agent_args = agent_args.copy()
            init_agent_args['log_file'] = f"chat_log_{agent_args['model']}_{timestamp}.txt"
            return ChatAgent(**init_agent_args)

        model_dropdown.change(fn=update_model, inputs=[model_dropdown, agent], outputs=[agent])
        demo.load(fn=init_agent, outputs=[agent])

    demo.launch()


def main(prompt_path: Path, model: str, show_reasoning, reasoning_effort: str | None, use_web: bool):
    agent_args = dict(
        model=model,
        prompt=prompt_path.read_text() if prompt_path else '',
        show_reasoning=show_reasoning,
        reasoning_effort=reasoning_effort

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
