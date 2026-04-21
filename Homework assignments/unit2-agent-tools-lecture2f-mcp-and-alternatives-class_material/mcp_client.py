import asyncio
import json
from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client

class MCPClient:
    def __init__(self, command: str, args: list[str]):
        self.server_params = StdioServerParameters(command=command, args=args)
        self._session: ClientSession | None = None
        self._tools: list = []

    async def __aenter__(self):
        self._cm = stdio_client(self.server_params)
        self._read, self._write = await self._cm.__aenter__()
        self._session = ClientSession(self._read, self._write)
        await self._session.__aenter__()
        await self._session.initialize()
        return self

    async def __aexit__(self, *args):
        await self._session.__aexit__(*args)
        await self._cm.__aexit__(*args)

    async def get_openai_tools(self) -> list:
        """Fetch tools from MCP server and convert to OpenAI function format."""
        result = await self._session.list_tools()
        openai_tools = []
        for tool in result.tools:
            openai_tools.append({
                "type": "function",
                "function": {
                    "name": tool.name,
                    "description": tool.description,
                    "parameters": tool.inputSchema
                }
            })
        self._tools = openai_tools
        return openai_tools

    async def call_tool(self, name: str, arguments: dict) -> str:
        """Call a tool on the MCP server and return the result as a string."""
        result = await self._session.call_tool(name, arguments)
        return "\n".join(
            block.text for block in result.content if hasattr(block, "text")
        )