---
name: feature-branches
description: Use when starting any change to the codebase (feature, bug fix, refactor), when committing, stashing, or switching work, or when merging a branch into master. Enforces one feature per branch and clean integration.
---

# One feature per branch

## Branching rules

1. **One concept per branch.** A branch holds exactly one feature, one bug fix, or
   one refactor. Never stack an unrelated change onto an existing feature branch,
   and never let two features share a branch or a commit.
2. **Name branches by the feature**: `feature/<name>` for features, `fix/<name>`
   for bug fixes, in kebab-case. The branch and the feature it carries must share
   a name semantic (e.g. `feature/ai-player-trading`, `fix/illegal-7-tokens`).
3. **Never start work without the right branch.** Before editing, list branches
   (`git branch -a`) and check for uncommitted work (`git status --short`). If the
   working tree is dirty, either commit it to its matching branch or stash it
   labelled (`git stash push -m "WIP <name>"` on that branch) — never let one
   feature's edits bleed into another's branch state.

## While working

4. **Commit early, in small commits**, each self-contained and message-complete:
   subject line states the change, and the commit includes everything that change
   needs (code + its tests + docs). Code, tests, and reference docs for one
   feature belong together, on that feature's branch.
5. **Validate before merging.** Run every relevant harness
   (`node tools/check.js`, `node tools/game-test.js`, `node tools/dom-test.js`)
   on the feature branch tip; all must pass before a merge is proposed.
6. **Reference docs first, code second.** For rule-driven work, summarise the
   rule and its implementation status in a reference doc (e.g. `rules.md`) on the
   same branch, and keep the doc and code in sync when behaviour changes.

## Merging

7. **Merge one branch at a time into master**: `git merge feature/<name>` —
   resolve conflicts only in that branch's domain; when a conflict overlaps a
   second feature's code, finish/merge the second feature (or revert to master's
   version) so a single conflict resolution never decides both features at once.
8. **Fast-forward or no-edit merge commits only**; merge messages name the branch
   (`Merge branch 'feature/<name>'`).
9. **After a merge, re-run all harnesses on master**, then delete the merged
   branch with `git branch -d feature/<name>` (safe: refuses unmerged work).

## Stash hygiene

10. Label every stash with the branch and work name (`WIP <name> on <branch>`).
11. A stash on branch B is only valid while branch B still needs it. After the
    stash's feature is committed, merged, or superseded by a newer iteration,
    verify reuse (`git stash show -p stash@{n}` compared with the landed code)
    and then drop it — no duplicate or stale stashes are kept.
