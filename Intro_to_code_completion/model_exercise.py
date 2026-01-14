from usage import print_usage
from openai import Client


def main():
    client = Client()
    model = ("gpt-5-nano",
             "gpt-3.5-turbo",
             "gpt-4.1-nano",
                )
    prompt = "Tell me a short story about a rabbit and a mushroom"
    for m in model:
        response = client.responses.create(
            model = m,
            input=prompt

    )
        print_usage(model, response.usage)
        print("\n")
        print(response.output_text)


if __name__ == '__main__':
    main()