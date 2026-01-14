import sys

from usage import print_usage
from openai import Client


def main(prompt:str):
    client = Client()
    model = "gpt-5-nano"
    with open(prompt, 'r') as f:
        prompt = f.read().strip()

    response = client.responses.create(
        model=model,
        input=prompt,
        reasoning={'effort': 'low'}

    )
    print_usage(model, response.usage)
    print(response.output_text)


if __name__ == '__main__':
    main(sys.argv[1])