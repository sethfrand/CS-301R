# Team Constructor Standards

Use these defaults unless the user explicitly asks for different conventions.

## Naming

- Roles: lowercase kebab-case path segments, e.g. `developer`, `developer/ui`.
- Skills: lowercase kebab-case path segments under a role, e.g. `developer/testing`.
- Prefer `-` over `_`.

## Role Files

Required files:
- `.myteam/<role>/info.md`
- `.myteam/<role>/role.md`
- `.myteam/<role>/load.py`

Required `role.md` sections:
- `## Your Role`
- `## How To Work`
- `## Handoff`

Required `info.md` content:
- One sentence describing ownership.
- One sentence describing delegation trigger and return criteria.

## Duplicate Role Prevention

- Before creating a new role, check existing roles for overlapping scope.
- If an existing role already fulfills the requested responsibility, show the user a diff of:
  - proposed role files, and
  - existing role files.
- Proceed with role creation only if the user explicitly wants a separate role after reviewing the diff.

## Skill Files

Required files:
- `.myteam/<role>/<skill>/info.md`
- `.myteam/<role>/<skill>/skill.md`
- `.myteam/<role>/<skill>/load.py`

Required `skill.md` sections:
- `# <Skill Name>`
- `## Quick Workflow`
- `## Handoff`

Required `info.md` content:
- One sentence describing what problem the skill solves.
- One sentence describing when to use it.

## Placeholder Text Policy

Do not leave unresolved placeholders such as:
- `<role>`
- `<skill>`
- `<task types>`
- `<trigger condition>`
- `TODO`
- `TBD`

## Verification

Run all applicable checks after edits:

```bash
myteam get role team_constructor
myteam get skill team_constructor/role_creation
myteam get skill team_constructor/skill_creation
python3 .myteam/team_constructor/tools/validate_myteam.py
```
