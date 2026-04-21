# MyTeam Role Creation

Use the `myteam` CLI for scaffolding roles: `myteam new role <role_path>`.

Examples:
- Top-level role: `myteam new role developer`
- Nested role: `myteam new role developer/ui`

Always apply `.myteam/team_constructor/standards.md` after scaffolding.

## Common Errors

- If you see `ERROR: Cannot find key: <role>`, you likely ran `myteam new <role>`. Use `myteam new role <role>`.
- Do not edit `AGENTS.md` for role content. Role metadata lives in `.myteam/<role>/info.md` and `.myteam/<role>/role.md`.
- Do not use unsupported helpers in `load.py`; use functions that exist in `myteam.utils`.

## Minimum Inputs Before Creation

- Role path (`<role_path>`), e.g. `developer/ui`.
- One-sentence ownership statement.
- Handoff criteria (when work returns to the delegator).

If any are missing, ask only for those missing fields.

## Existing Role Reuse Policy

Before creating a new role, inspect current roles under `.myteam/` and identify any role with overlapping ownership.

- If an existing role already fulfills the requested responsibility, do not create a new role by default.
- Produce and show a diff between:
  - the proposed role content, and
  - the existing role content.
- Ask the user whether to update the existing role or proceed with a new role after reviewing the diff.

Suggested diff workflow:

```bash
diff -u .myteam/<existing_role>/role.md /tmp/proposed_role.md
diff -u .myteam/<existing_role>/info.md /tmp/proposed_info.md
```

## Quick Workflow

1. Check existing roles for overlap in ownership and scope.
2. If overlap exists, draft proposed updates and show diffs vs existing role files.
3. Only create a new role when the user explicitly confirms a separate role is needed.
4. Validate with `myteam get role <role>` and `python3 .myteam/team_constructor/tools/validate_myteam.py`.

## Role Instructions

After running `myteam new role <role_path>`, `myteam` creates `info.md`, `load.py`, and `role.md` in `.myteam/<role>/`.
`role.md` defines behavior. `info.md` is delegation guidance for supervisors.

### Writing `role.md`

`role.md` should be concise and specific:
- Scope and responsibilities
- Working rules
- Handoff criteria

Keep role responsibilities focused to one core area.

### Writing `info.md`

`info.md` should be brief and contain:
- What the role owns
- When to delegate to it
- When the role should hand back

### Required Outputs Checklist

- Role directory exists at `.myteam/<role>/`.
- `info.md` is not placeholder text and includes handoff guidance.
- `role.md` includes role duties and handoff criteria.
- Files meet section requirements from `.myteam/team_constructor/standards.md`.

### Verification

After edits, run `myteam get role <role>` to confirm the new role renders without placeholder text.
Then run: `python3 .myteam/team_constructor/tools/validate_myteam.py`

### Templates

Use these as starting points and adjust per project needs.

`info.md` template:

```
A brief, concrete description of the role and what it owns.

Hand off to this role for <task types>. Hand off back once <done criteria> or when <decision needed>.
```

`role.md` template:

```
## Your Role

You are the <Role Name> for this project. Describe your core responsibilities.

## How To Work

- Read existing code and tests before changing behavior.
- Prefer minimal changes that satisfy the requirement.
- Add or update tests when behavior changes.
- Update docs/config when required by the change.
- Flag unclear requirements or risky assumptions early.

## Handoff

- Handoff to the team lead when a change is ready for review, or when you need a decision on scope, priority, or product behavior.
- If blocked by missing context or access, report the blocker and suggest the next best step.
```

### Modifying `load.py`

In most cases, `load.py` should not need modification. Change it only when extra load-time behavior is required.
