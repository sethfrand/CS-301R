import argparse
import asyncio
import logging
import os
import sys
from pathlib import Path

import yaml
from openai import AsyncOpenAI

from run_agent import run_agent, as_tool, Agent, conclude, current_agent
from tools import ToolBox
from usage import print_usage

LOG_FORMAT = '%(filename)-10.10s %(levelname)-4.4s %(asctime)s %(message)s'

toolbox = ToolBox()
toolbox.tool(conclude)


@toolbox.tool
def talk_to_user(message: str):
    """
    Use this function to communicate with the user.
    All communication to and from the user **MUST**
    be through this tool.
    :param message: The message to send to the user.
    :return: The user's response.
    """
    _agent = current_agent.get()
    name = _agent['name'] if _agent else 'Agent'
    print(f'{name}: {message}')
    return input('User: ')


@toolbox.tool
def present_options(question: str, options: str):
    """
    Ask the user to pick from a short set of options.
    Provide options as a newline-separated string.
    Returns the selected option text when the user enters
    a number, and otherwise returns the raw response.
    Use this when the user's preference will materially
    change the plan and they have not already decided.
    """
    _agent = current_agent.get()
    name = _agent['name'] if _agent else 'Agent'
    choices = [option.strip() for option in options.splitlines() if option.strip()]

    print(f'{name}: {question}')
    for index, choice in enumerate(choices, start=1):
        print(f'  {index}. {choice}')

    response = input('User: ').strip()

    if response.isdigit():
        selection = int(response)
        if 1 <= selection <= len(choices):
            return choices[selection - 1]

    normalized = response.casefold()
    for choice in choices:
        if normalized == choice.casefold():
            return choice

    return response


async def main(agent_config: Path, message: str):
    client = AsyncOpenAI()
    usages = []

    main_agent = _load_agents(agent_config, client, usages)

    response = await run_agent(
        client, toolbox, main_agent,
        message, usage=usages
    )

    if response:
        print(response)
        print()

    print_usage(usages)


def _load_agents(agent_config: Path, client: AsyncOpenAI, usages: list):
    def add_to_toolbox(_agent):
        toolbox.tool(as_tool(client, toolbox, _agent, usage=usages))

    agents: list[Agent] = list(yaml.safe_load_all(agent_config.read_text()))

    for agent in agents:
        if agent['name'] == 'main':
            continue
        add_to_toolbox(agent)

    return next(agent for agent in agents if agent['name'] == 'main')


async def chat(agent_config: Path, message: str | None = None):
    client = AsyncOpenAI()
    usages = []
    main_agent = _load_agents(agent_config, client, usages)
    history = []
    pending_message = message

    print("Agent-controlled chat. Type 'exit' or 'quit' to stop.\n")

    while True:
        try:
            if pending_message is None:
                pending_message = input('User: ').strip()
            else:
                print(f'User: {pending_message}')

            if not pending_message:
                pending_message = None
                continue

            if pending_message.casefold() in {'exit', 'quit'}:
                break

            response = await run_agent(
                client,
                toolbox,
                main_agent,
                user_message=pending_message,
                history=history,
                usage=usages,
            )
        except (EOFError, KeyboardInterrupt):
            print()
            break

        if response:
            print(f"{main_agent['name']}: {response}\n")

        pending_message = None

    print_usage(usages)


def _configure_logging(debug: bool) -> None:
    local_level = logging.DEBUG if debug else logging.INFO
    use_dark_gray = (
            sys.stderr.isatty()
            and os.getenv('NO_COLOR') is None
            and os.getenv('TERM', '').lower() != 'dumb'
    )
    format_string = f'\x1b[90m{LOG_FORMAT}\x1b[0m' if use_dark_gray else LOG_FORMAT
    logging.basicConfig(
        level=logging.WARNING,
        format=format_string,
        datefmt='%H:%M:%S',
        force=True,
    )
    for logger_name in ('__main__', 'agents', 'run_agent', 'tools', 'usage'):
        logging.getLogger(logger_name).setLevel(local_level)


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('agent_config', type=Path, nargs='?', default=Path('hub_spoke_agent.yaml'))
    parser.add_argument('message', nargs='?', default=None)
    parser.add_argument('--chat', action='store_true')
    parser.add_argument('--debug', action='store_true')
    args = parser.parse_args()
    _configure_logging(args.debug)
    runner = chat if args.chat else main
    asyncio.run(runner(args.agent_config, args.message))
