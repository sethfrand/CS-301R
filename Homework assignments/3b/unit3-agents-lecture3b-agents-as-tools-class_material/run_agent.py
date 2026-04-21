import asyncio
import json
import logging
import time
from contextvars import ContextVar
from typing import TypedDict

current_agent = ContextVar('current_agent')
logger = logging.getLogger(__name__)


class Agent(TypedDict):
    name: str
    description: str
    model: str
    prompt: str
    tools: list[str]
    kwargs: dict


def conclude():
    """
    Conclude the conversation.
    """


async def run_agent(
        client,
        toolbox,
        agent: Agent,
        user_message: str = None,
        history=None,
        usage=None
) -> str | None:
    current_agent.set(agent)

    if history is None:
        history = []
    if usage is None:
        usage = []

    if user_message:
        history.append({'role': 'user', 'content': user_message})

    while True:
        history_for_response = history
        if prompt := agent.get('prompt'):
            history_for_response = history_for_response + [{'role': 'system', 'content': prompt}]

        start = time.time()
        logger.debug('AGENT %s', agent['name'])
        response = await client.responses.create(
            input=history_for_response,
            model=agent.get('model', 'gpt-5-mini'),
            tools=toolbox.get_tools(agent.get('tools', [])),
            **agent.get('kwargs', {})
        )
        logger.debug(
            'RESPONSE from %s in %.2f seconds',
            agent['name'],
            time.time() - start,
        )

        usage.append((agent.get('model', response.model), response.usage))
        history.extend(
            response.output
        )

        outputs = [
            item
            for item in response.output
            if item.type == 'message'
        ]
        message_text = '\n'.join(
            chunk.text
            for item in outputs
            for chunk in item.content
        )

        function_calls = [
            item
            for item in response.output
            if item.type == 'function_call'
        ]

        # A plain message with no tool calls ends the current turn.
        if outputs and not function_calls:
            return message_text

        # `conclude` marks the end of the current turn. Preserve any final
        # assistant message returned alongside it.
        if any(
                item.name == conclude.__name__
                for item in function_calls
        ):
            return message_text or None

        # tool calls
        tool_calls = {
            item.call_id: toolbox.run_tool(item.name, **json.loads(item.arguments))
            for item in function_calls
        }

        results = await asyncio.gather(*(
            asyncio.create_task(tool_call)
            for tool_call in tool_calls.values()
        ))

        for call_id, result in zip(tool_calls.keys(), results):
            history.append({
                'type': 'function_call_output',
                'call_id': call_id,
                'output': str(result)
            })


def as_tool(
        client, toolbox, agent,
        history=None,
        usage=None
):
    agent_history = history if history is not None else []

    async def function(input: str) -> str:
        result = await run_agent(
            client, toolbox, agent,
            user_message=input, history=agent_history, usage=usage
        )
        return result or ''

    function.__name__ = agent['name']
    function.__doc__ = agent.get('description', '')

    return function
