import sys
from os import path
from time import time

from openai import Client, BadRequestError

from usage import print_usage


def main():
    if len(sys.argv) < 2:
        persona_content = ""
        persona_name = "default"
    else:
        persona_file = sys.argv[1]
        persona_name = path.splitext(path.basename(persona_file))[0]
        with open(persona_file, 'r') as f:
            persona_content = f.read()

    client = Client()
    model = "gpt-5-nano"
    history = []
    if persona_content:
        history.append({'role': 'system', 'content': persona_content})
    usages = []
    try:
        while True:
            message = input('User: ')
            history.append({'role': 'user', 'content': message})
            start = time()
            
            try:
                # Attempt to use reasoning
                response = client.responses.create(
                    model=model,
                    input=history,
                    reasoning={'effort': 'low'}
                )
            except BadRequestError as e:
                # If reasoning is unsupported, fall back to a standard request
                if 'reasoning' in str(e).lower():
                    response = client.responses.create(
                        model=model,
                        input=history
                    )
                else:
                    raise e
                    
            history.append({'role': 'assistant', 'content': response.output_text})
            usages.append(response.usage)
            print('Agent:', response.output_text)
            print(f'Took {round(time() - start, 2)} seconds')
    except KeyboardInterrupt:
        pass

    # Save conversation history
    history_filename = f"conversation_history_{persona_name}.md"
    with open(history_filename, 'w') as f:
        for entry in history:
            f.write(f"## {entry['role'].capitalize()}\n")
            f.write(f"{entry['content']}\n\n")

        f.write("\n---\n")
        print_usage(model, usages, file=f)

    print(f"\nConversation history saved to {history_filename}")
    print_usage(model, usages)


if __name__ == '__main__':
    main()
