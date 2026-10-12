---
name: delegate
description: Write the prompt for a plan-executor agent. Use whenever the main session hands planned work (implementation, review fixes, a read-only review) to an agent in this repo.
---

# Delegating planned work

Spawn `subagent_type: "plan-executor"` (Sonnet, effort medium, defined in `.claude/agents/plan-executor.md`). Its
system prompt already holds the repo rules, the Podman database recipe, the gates, the commit trailer, the no-push rule
and the report format. **Do not repeat those.** The prompt carries only what is specific to this task, and must be
complete enough that a medium-effort model never has to re-derive a decision.

## Checklist for the prompt

1. **Setup:** base ref (branch + short SHA) and the new branch name; `isolation: "worktree"` for anything that edits.
2. **Goal** in one or two sentences, and the doc section it comes from (`docs/p1-plan.md` workstream X, a review).
3. **Decisions already taken:** state them as final, with the exact values (limits, perms, enum values, error text,
   order of operations). Name the house-decision number when one is to be added.
4. **Scope:** files and folders allowed; files forbidden because another agent is on them. Name the parallel agents'
   areas so merges stay easy.
5. **Items:** numbered, each with file:line, what is wrong or missing, and the exact fix. Mark merge-blocking ones.
6. **Reuse:** existing functions, schemas and patterns to build on (names and paths), so nothing is reinvented.
7. **Tests:** which unit and smoke assertions to add, including refusal cases. Synthetic fixtures only.
8. **Database and port** when the api runs: a unique `<db>` and `<port>` not used by another running agent
   (`it` and `:4000` are the main checkout's).
9. **UI:** say so explicitly when the task has UI, so the agent runs `frontend-design:frontend-design` first.
10. **Report extras:** anything beyond the standard report you need back (API names, contract changes for another
    workstream).

## After it reports

Verify independently before relaying: rerun the gates (and smoke on a fresh database) on the agent's branch, then
cherry-pick or merge into the target branch. Relay the outcome to the user, not the agent's wording.
