#!/usr/bin/env python3

from pathlib import Path
from myteam.utils import print_instructions


def main() -> int:
    base = Path(__file__).resolve().parent  # .myteam/<role>
    print_instructions(base)
    print((base.parent / 'team_member_instructions.md').read_text())
    print((base.parent / 'send_message_instructions.md').read_text())

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
