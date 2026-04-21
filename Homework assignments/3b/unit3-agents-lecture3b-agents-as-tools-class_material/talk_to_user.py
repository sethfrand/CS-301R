# Copy-paste into agents.py

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
