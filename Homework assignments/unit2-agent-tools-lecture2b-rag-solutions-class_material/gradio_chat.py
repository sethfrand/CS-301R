import argparse
import asyncio
from pathlib import Path

import gradio as gr
from openai import AsyncOpenAI, BadRequestError
import chromadb
from chromadb.utils.embedding_functions import OpenAIEmbeddingFunction

from usage import *

class ChatAgent:
    def __init__(self, model:str, prompt:str, chroma_dir:str=None, collection_name:str=None):
        self.model = model
        self.prompt = prompt
        self.history = []
        self.usage = []
        self.ai = AsyncOpenAI()
        self.chroma_collection = None

        if chroma_dir and collection_name:
            client = chromadb.PersistentClient(path=chroma_dir)
            openai_ef = OpenAIEmbeddingFunction(model_name="text-embedding-3-small")
            self.chroma_collection = client.get_collection(
                name=collection_name,
                embedding_function=openai_ef
            )

        if prompt:
            self.history.append({'role': 'user', 'content': prompt})
    async def get_response(self, usr_text: str):
        # Retrieve relevant context from ChromaDB if available
        if self.chroma_collection:
            results = self.chroma_collection.query(
                query_texts=[usr_text],
                n_results=3,
                include=["documents", "metadatas"]
            )
            context = "\n\n".join(results["documents"][0])
            augmented_message = f"Context from General Conference talks:\n{context}\n\nUser question: {usr_text}"
            self.history.append({'role': 'user', 'content': augmented_message})
        else:
            self.history.append({'role': 'user', 'content': usr_text})

        if not usr_text:
            return ''
        try:
            response = await self.ai.responses.create(
                model=self.model,
                input=self.history,
                reasoning={'effort': 'low'}
            )
        except BadRequestError as e:
            if 'reasoning' in str(e).lower():
                response = await self.ai.responses.create(
                    model=self.model,
                    input=self.history
                )
            else:
                raise e
        
        self.usage.append(response.usage)
        self.history.extend(response.output)
        return response.output_text

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc_val, exc_tb):
        print_usage(self.model, self.usage)


async def _main_console(agent):
    while True:
        message = input('User: ')
        if not message:
            break
        response = await agent.get_response(message)
        print('Agent:', response)


def _main_gradio(agent):
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
    """

    usage_view = gr.Markdown(format_usage_markdown(agent.model, []))

    with gr.Blocks(css=css, theme=gr.themes.Monochrome()) as demo:
        with gr.Row():
            model_dropdown = gr.Dropdown(
                choices=['gpt-5-nano','gpt-4.1-nano','gpt-5-mini','gpt-5.2-pro'],
                value = agent.model,
                label='Model selction')

        def change_model(new_model):
            agent.model = new_model
            return format_usage_markdown(agent.model,agent.usage)

        model_dropdown.change(fn=change_model, inputs=model_dropdown, outputs=usage_view)
        async def get_response(message, chat_view_history):
            response = await agent.get_response(message)
            usage_content = format_usage_markdown(agent.model, agent.usage)
            return response, usage_content

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
                    additional_outputs=[usage_view]
                )

            with gr.Column(scale=1):
                usage_view.render()

    demo.launch()


def main(prompt_path: Path, model: str, use_web: bool, chroma_dir: str = None, collection_name: str = None):
    with ChatAgent(model, prompt_path.read_text() if prompt_path else '', chroma_dir, collection_name) as agent:
        if use_web:
            _main_gradio(agent)
        else:
            asyncio.run(_main_console(agent))


if __name__ == "__main__":
    parser = argparse.ArgumentParser('ChatBot')
    parser.add_argument('prompt_file', nargs='?', type=Path, default=None)
    parser.add_argument('--web', action='store_true')
    parser.add_argument('--model', default='gpt-5-nano')
    parser.add_argument('--chroma-dir', default=None, help='Path to ChromaDB directory')
    parser.add_argument('--collection', default=None, help='ChromaDB collection name')
    args = parser.parse_args()
    main(args.prompt_file, args.model, args.web, args.chroma_dir, args.collection)
