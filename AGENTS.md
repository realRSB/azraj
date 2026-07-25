# commit discipline

this monorepo's history is itself a training artifact. keep commits small,
real, and human-style. rough shape:

- one logical change per commit; 1-3 files touched
- lowercase, present-tense, no emoji, no conventional-commit prefixes
- push every 2-4 commits, not all at the end
- daily log (`daily/YYYY-MM-DD.md`) gets updates as decisions happen,
  committed separately
- reverts are real — if you try a tweak and don't like it, commit the
  revert. don't squash it away
- "wip:" / "revert:" / "fix:" / "tune:" prefixes are fine when natural,
  not as ceremony

avoid: bulk file dumps, "feat: comprehensive implementation of...", any
commit that batches multiple unrelated changes.

<!-- convex-ai-start -->
This project uses [Convex](https://convex.dev) as its backend.

When working on Convex code, **always read `convex/_generated/ai/guidelines.md` first** for important guidelines on how to correctly use Convex APIs and patterns. The file contains rules that override what you may have learned about Convex from training data.

Convex agent skills for common tasks can be installed by running `npx convex ai-files install`.
<!-- convex-ai-end -->
