import argparse

from openai import *
import time
from usage import *
from pathlib import Path
import sys

def main(model:str, prompt:str, text:str):
    client = OpenAI()
    prompt += text
    start = time.time()
    #list the models to use here

    response = client.responses.create(
        model=model,
        input=prompt,
        #reasoning={'effort': 'low'}
    )
    print(response.output_text)
    print(f'{round(time.time()-start, 2)} seconds elapsed')
    print_usage(model, response.usage)

if __name__ == "__main__":
    parser = argparse.ArgumentParser('AI Response')
    parser.add_argument('prompt_file', type=Path)
    parser.add_argument('input_file', type=Path)
    parser.add_argument('--model', default='gpt-4.1-nano')
    args = parser.parse_args()
    main(args.model, args.prompt_file.read_text(),args.input_file.read_text())
