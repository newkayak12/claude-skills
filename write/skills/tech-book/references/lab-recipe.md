# Lab recipe — running a chapter's labs

For the stage-4 fact check, the stage-5 reviser, the closure re-check, and stage 6b. Book values (engine, image tag,
version) come from `brief.md`, never from this file.

- **NEVER run `docker * prune`, `docker system …`, or any host-wide cleanup. Copy this line into every subagent brief.**
  A reader check once ran `docker volume prune -f` and deleted 7.98 GB of volumes it did not own.
- Lab dir `$HOME/<slug>-chNN-<role>-rK/` (role: fact, reader, reviser, closure, 6b) — not `/tmp`: snap docker cannot
  mount it. `export COMPOSE_PROJECT_NAME=<slug>-chNN-<role>-rK` (lowercase letters, digits, `-`); every container,
  volume, and network carries that name.
- No host port publish (`-p N:N`, `--publish`, `ports:`); connect through `docker exec` / `docker compose exec`. Two
  runners on one fixed port collided.
- Labs without containers keep the same dir, naming, and exact-name teardown for every process and file they create.
- Start from N-1's `artifacts/chNN-1/rebuild-end-state.sh` in an empty chapter artifact dir; a stale `artifacts/chNN/`
  from an earlier round is deleted first.
- Run each block by the method the text gives the reader — interactive or piped, as printed — and say which. Record
  command, exit code, and observed output beside the printed output; printed ≠ observed is 🔴.
- Any lab, code, or output change → re-run the whole chain in one script from the rebuild script, not only the changed
  block.
- Teardown only by exact name: `docker compose -p <name> down -v`, `docker rm -fv <name>`, `rm -rf $HOME/<name>/`.
  List what carries that name first; touch nothing else.
- Official docs unreachable = any fetch failure (timeout, 403, empty page); record URL and error in the review file,
  then apply the archive rule of SKILL.md stage 4.
- Theory with no official docs (an algorithm, a paper's model): cite a named textbook edition + section, else
  `[확인 필요]`.
