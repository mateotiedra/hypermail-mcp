---
description: Release to npm — update README, test, build, publish, push
argument-hint: "[patch|minor|major]"
---

Review the git log since the last release (`git log --oneline $(git describe --tags --abbrev=0 2>/dev/null || echo HEAD~10)..HEAD`) and update `README.md` with any relevant changes, new features, or fixes.

Then, in order:

1. **Bump version:** `npm version $1` (or `npm version patch` if no argument given).
   - This bumps `package.json`, creates a git commit, and tags the release.

2. **Build:** `pnpm build`
   - This compiles TypeScript via tsup → `dist/cli.js`.

3. **Publish to npm:** `npm publish`
   - The `prepublishOnly` script will run build + tests as a final safety check.

4. **Push git release:** `git push --follow-tags origin HEAD`
   - Do this only after `npm publish` succeeds. This pushes the release commit and tag for the current branch.
