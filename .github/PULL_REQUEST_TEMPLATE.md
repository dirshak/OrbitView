<!--
Thanks for sending a pull request. A few quick notes before you submit:

1. For non-trivial changes, please open an issue or discussion first so we can align on scope.
2. Keep the PR focused. Smaller PRs ship faster than perfect ones.
3. Run the backend and frontend test suites locally before pushing.
-->

## Summary

<!-- 1-3 bullets describing WHAT this PR does and WHY. Link related issues with "Closes #123". -->

-
-

## Type of change

<!-- Tick all that apply. -->

- [ ] Bug fix (non-breaking change that fixes an issue)
- [ ] New feature (non-breaking change that adds functionality)
- [ ] Breaking change (fix or feature that changes existing behavior)
- [ ] Documentation update
- [ ] Internal / refactor / chore (no user-visible change)
- [ ] Infrastructure (Docker, CI, deployment)

## Test plan

<!-- How did you verify this works? Be specific. Reviewers should be able to reproduce. -->

- [ ] `dotnet test backend/AstroTrack.sln` succeeds
- [ ] `npm test` (in `frontend/`) succeeds
- [ ] `npm run build` (in `frontend/`) succeeds
- [ ] Ran the stack locally (`docker compose up --build`) and verified the change
- [ ] Updated or added tests for new behavior
- [ ] Updated README / docs if applicable

## Checklist

- [ ] My commit messages follow the project convention (imperative mood, short subject)
- [ ] I have read [CONTRIBUTING.md](CONTRIBUTING.md)
- [ ] I have read and agree to the [Code of Conduct](CODE_OF_CONDUCT.md)
- [ ] I have not committed any secrets, credentials, or `.env` files
