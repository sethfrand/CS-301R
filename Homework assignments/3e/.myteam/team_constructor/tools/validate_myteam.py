#!/usr/bin/env python3
from __future__ import annotations

import argparse
from pathlib import Path
import sys
import re


PROJECT_ROOT = Path(__file__).resolve().parents[3]
MYTEAM_ROOT = Path(__file__).resolve().parents[2]

ROLE_REQUIRED_FILES = ("info.md", "role.md", "load.py")
SKILL_REQUIRED_FILES = ("info.md", "delegation-skill.md", "load.py")
ROLE_REQUIRED_HEADINGS = ("Your Role", "How To Work", "Handoff")
SKILL_REQUIRED_HEADINGS = ("Quick Workflow", "Handoff")
PLACEHOLDER_TOKENS = ("<role>", "<skill>", "<task types>", "<trigger condition>", "TODO", "TBD")
PLACEHOLDER_EXCLUDE_PREFIXES = ("team_constructor/",)
REQUIRED_DELEGATION_PHRASES = (
    "assume this role for the full task",
    "do not call or require spawn-agent",
)


def is_role_dir(path: Path) -> bool:
    return path.is_dir() and (path / "role.md").exists()


def is_skill_dir(path: Path) -> bool:
    return path.is_dir() and (path / "delegation-skill.md").exists()


def rel(path: Path) -> str:
    return path.relative_to(PROJECT_ROOT.parent).as_posix()


def rel_in_myteam(path: Path) -> str:
    return path.relative_to(MYTEAM_ROOT).as_posix()


def _strip_code(text: str) -> str:
    # Ignore fenced and inline code samples when checking placeholders.
    text = re.sub(r"```[\s\S]*?```", "", text)
    text = re.sub(r"`[^`]*`", "", text)
    return text


def _has_heading(text: str, heading: str) -> bool:
    pattern = rf"^\s{{0,3}}#{{1,6}}\s+{re.escape(heading)}\s*$"
    return re.search(pattern, text, flags=re.MULTILINE) is not None


def check_required_files(base: Path, files: tuple[str, ...], errors: list[str]) -> None:
    for name in files:
        if not (base / name).exists():
            errors.append(f"{rel(base)} missing required file: {name}")


def check_headings(path: Path, required: tuple[str, ...], errors: list[str]) -> None:
    if not path.exists():
        return
    txt = path.read_text(encoding="utf-8")
    for heading in required:
        if not _has_heading(txt, heading):
            errors.append(f"{rel(path)} missing heading: {heading}")


def check_placeholders(path: Path, errors: list[str]) -> None:
    if not path.exists():
        return
    rel_path = rel_in_myteam(path)
    if any(rel_path.startswith(prefix) for prefix in PLACEHOLDER_EXCLUDE_PREFIXES):
        return
    txt = _strip_code(path.read_text(encoding="utf-8"))
    for token in PLACEHOLDER_TOKENS:
        if token in txt:
            errors.append(f"{rel(path)} contains placeholder token: {token}")


def check_structure() -> list[str]:
    errors: list[str] = []

    for path in sorted(MYTEAM_ROOT.rglob("*")):
        if not path.is_dir():
            continue

        if is_role_dir(path):
            check_required_files(path, ROLE_REQUIRED_FILES, errors)
            check_headings(path / "role.md", ROLE_REQUIRED_HEADINGS, errors)
            check_placeholders(path / "role.md", errors)
            check_placeholders(path / "info.md", errors)

        if is_skill_dir(path):
            check_required_files(path, SKILL_REQUIRED_FILES, errors)
            check_headings(path / "delegation-skill.md", SKILL_REQUIRED_HEADINGS, errors)
            check_placeholders(path / "delegation-skill.md", errors)
            check_placeholders(path / "info.md", errors)

    return errors


def check_delegation_text(text: str) -> list[str]:
    errors: list[str] = []

    role_match = re.search(r"(?m)^\s*role:\s*(.+?)\s*$", text)
    if not role_match:
        errors.append("delegation text missing required line: role: <exact-role-name>")
        return errors

    role_name = role_match.group(1).strip()
    valid_roles = sorted(p.name for p in MYTEAM_ROOT.iterdir() if p.is_dir())
    if role_name not in valid_roles:
        errors.append(
            f"delegation role '{role_name}' does not match an immediate .myteam subdirectory "
            f"(valid: {', '.join(valid_roles)})"
        )

    for phrase in REQUIRED_DELEGATION_PHRASES:
        if phrase not in text:
            errors.append(f"delegation text missing required phrase: {phrase}")

    return errors


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description=(
            "Validate .myteam structure. Optionally validate delegation text with "
            "--delegation-file or --delegation-text."
        )
    )
    parser.add_argument(
        "--delegation-file",
        type=Path,
        help="Path to text containing delegation instructions to validate.",
    )
    parser.add_argument(
        "--delegation-text",
        help="Raw delegation instruction text to validate.",
    )
    parser.add_argument(
        "--delegation-only",
        action="store_true",
        help="Run only delegation checks (skip structure checks).",
    )
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    errors: list[str] = []

    if args.delegation_file and args.delegation_text:
        print("Validation failed:")
        print("- use only one of --delegation-file or --delegation-text")
        return 1

    if not args.delegation_only:
        errors.extend(check_structure())

    if args.delegation_file or args.delegation_text:
        delegation_text = args.delegation_text
        if args.delegation_file:
            try:
                delegation_text = args.delegation_file.read_text(encoding="utf-8")
            except OSError as exc:
                print("Validation failed:")
                print(f"- unable to read delegation file: {args.delegation_file} ({exc})")
                return 1

        errors.extend(check_delegation_text(delegation_text or ""))

    if errors:
        print("Validation failed:")
        for err in errors:
            print(f"- {err}")
        return 1

    if args.delegation_file or args.delegation_text:
        if args.delegation_only:
            print("Validation passed: delegation text checks succeeded.")
        else:
            print("Validation passed: structure and delegation text checks succeeded.")
    else:
        print("Validation passed: all discovered roles/skills meet required structure checks.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
