#!/usr/bin/env python3
from __future__ import annotations

from pathlib import Path

from myteam.utils import (
    print_instructions,
    get_myteam_root,
    list_roles,
    list_skills,
    explain_skills,
)


def main() -> int:
    base = Path(__file__).resolve().parent  # .myteam/<role>
    root = get_myteam_root(base)
    print_instructions(base)
    explain_skills()
    list_roles(base, root, [])
    list_skills(base, root, [])

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
