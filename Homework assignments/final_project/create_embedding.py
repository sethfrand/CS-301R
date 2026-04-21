def create_embedding_doc(shoe):

    specs = "\n".join(
        f"{k}: {v}" for k, v in shoe["specs"].items()
    )

    pros = ", ".join(shoe["pros"])
    cons = ", ".join(shoe["cons"])

    return f"""
    Running shoe: {shoe['model']}

    Pros: {pros}
    Cons: {cons}

    Lab measurements and specifications:
    {specs}
    """