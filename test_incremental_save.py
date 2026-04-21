import asyncio
import os
from unittest.mock import AsyncMock, MagicMock
from pathlib import Path
import sys

# Add the directory containing chatbot.py and usage.py to sys.path
chatbot_dir = Path("/Users/sethfrandsen/Desktop/school/Winter-2026/301R-Agent_Engineering/Homework assignments/homework1c--Chatbot")
sys.path.append(str(chatbot_dir))

from chatbot import ChatAgent

async def test_incremental_save():
    filename = "test_incremental_history.md"
    if os.path.exists(filename):
        os.remove(filename)

    model = "gpt-5-nano"
    prompt = "You are a helpful assistant."
    
    print("--- Initializing ChatAgent ---")
    agent = ChatAgent(model, prompt)
    # Check if file exists after init (due to system prompt)
    if os.path.exists(filename):
        print(f"File {filename} created after __init__.")
        with open(filename, "r") as f:
            content = f.read()
            if "## System" in content and "You are a helpful assistant." in content:
                print("System prompt found in file.")
            else:
                print("System prompt NOT found in file.")
    else:
        print(f"File {filename} NOT created after __init__.")

    # Mock OpenAI response
    mock_response = MagicMock()
    mock_response.usage = MagicMock()
    mock_response.usage.input_tokens = 10
    mock_response.usage.input_tokens_details.cached_tokens = 0
    mock_response.usage.output_tokens = 5
    mock_response.usage.output_tokens_details.reasoning_tokens = 0
    mock_response.output = [{'role': 'assistant', 'content': 'Hello! How can I help you?'}]
    mock_response.output_text = 'Hello! How can I help you?'
    
    agent._ai.responses.create = AsyncMock(return_value=mock_response)

    print("\n--- Getting first response ---")
    await agent.get_response("Hi")
    
    if os.path.exists(filename):
        print(f"File {filename} exists after first response.")
        with open(filename, "r") as f:
            content = f.read()
            if "## User" in content and "Hi" in content:
                print("User message found in file.")
            if "## Assistant" in content and "Hello! How can I help you?" in content:
                print("Assistant response found in file.")
    else:
        print(f"File {filename} NOT found after first response.")

    print("\n--- Getting second response ---")
    mock_response.output = [{'role': 'assistant', 'content': 'I am still here.'}]
    mock_response.output_text = 'I am still here.'
    await agent.get_response("Are you there?")

    if os.path.exists(filename):
        print(f"File {filename} exists after second response.")
        with open(filename, "r") as f:
            content = f.read()
            if "Are you there?" in content and "I am still here." in content:
                print("Second exchange found in file.")
            
            # Count occurrences of headers to ensure it's not just appending the whole history repeatedly
            # Actually save_history overwrites the file ("w"), so it should contain the full history exactly once.
            user_count = content.count("## User")
            assistant_count = content.count("## Assistant")
            print(f"User headers: {user_count}, Assistant headers: {assistant_count}")

    # Cleanup
    if os.path.exists(filename):
        os.remove(filename)

if __name__ == "__main__":
    asyncio.run(test_incremental_save())
