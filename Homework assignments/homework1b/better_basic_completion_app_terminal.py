import argparse
import time
from pathlib import Path

from openai import OpenAI

from usage import print_usage


def main(model: str, prompt: str, text: str):
    client = OpenAI()
    full_prompt = f"{prompt}\n{text}"
    start = time.time()

    response = client.responses.create(
        model=model,
        input=(
            "Answer the following prompt clearly and, if appropriate, return valid JSON "
            "with an 'answer' field.\n\n"
            f"{full_prompt}"
        ),
        # reasoning={'effort': 'low'}
    )

    print(response.output_text)
    print(f"{round(time.time() - start, 2)} seconds elapsed")
    print_usage(model, response.usage)


if __name__ == "__main__":
    parser = argparse.ArgumentParser("AI Response")
    parser.add_argument("prompt_file", type=Path)
    parser.add_argument("input_file", type=Path)
    parser.add_argument("--model", default="gpt-4.1-nano")
    args = parser.parse_args()
    main(args.model, args.prompt_file.read_text(), args.input_file.read_text())
