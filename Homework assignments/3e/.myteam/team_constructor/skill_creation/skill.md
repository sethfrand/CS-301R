# MyTeam skill Creation

Use the `myteam` CLI for scaffolding skills: `myteam new skill <skill_path>`.

Example:
- `myteam new skill developer/sql`

Always apply `.myteam/team_constructor/standards.md` after scaffolding.

## Common Errors

- If you see `ERROR: Cannot find key: <skill>`, you likely ran `myteam new <skill>`. Use `myteam new skill <skill>`.
- Do not edit `AGENTS.md` for skill content. Skills live under `.myteam/<role>/<skill>/`.
- Do not use unsupported helpers in `load.py`; use functions that exist in `myteam.utils`.

## Minimum Inputs Before Creation

- Skill path (`<role>/<skill>`), e.g. `developer/testing`.
- One-sentence skill purpose.
- Trigger conditions for when to use the skill.

If any are missing, ask only for those missing fields.

## Directory Conventions

- Place skills under the role that uses them, e.g. `.myteam/developer/testing/`.
- Use lowercase names; prefer `-` over `_` unless the project already uses `_`.

## Skill Instructions

After running `myteam new skill <skill_path>`, `myteam` creates `info.md`, `load.py`, and `skill.md` in
`.myteam/<role>/<skill>/`. `skill.md` contains detailed operating instructions.

### Writing `skill.md`

`skill.md` should be concise and actionable:
- Context/trigger
- Step-by-step workflow
- Handoff expectations

If scripts/resources are required, reference exact paths and usage.

### Writing `info.md`

`info.md` should be brief and describe:
- Problem solved by the skill
- When an agent should adopt it

### Required Outputs Checklist

- Skill directory exists at `.myteam/<role>/<skill>/`.
- `info.md` is not placeholder text and clearly describes when to use the skill.
- `skill.md` includes a minimal workflow and handoff guidance (if applicable).
- Files meet section requirements from `.myteam/team_constructor/standards.md`.

### Verification

After edits, run `myteam get skill <skill_path>` to confirm the new skill renders without placeholder text.
Then run: `python3 .myteam/team_constructor/tools/validate_myteam.py`

### Templates

Use these as starting points and adjust per project needs.

`info.md` template:

```
Brief description of what the skill enables.

Use this skill for <task types> or when <trigger condition>.
```

`skill.md` template:

```
# <Skill Name>

Use this skill when <context/trigger>.

## Quick Workflow

1. <Step one>
2. <Step two>
3. <Step three>

## Handoff

- If done, report <what to report>.
- If blocked, report <blocker details> and suggest next steps.
```

### Modifying `load.py`

The `load.py` scaffold presents `skill.md`. Update only when additional load-time setup is required.
