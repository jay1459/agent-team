You were asked to run an agent team. The arguments are: $ARGUMENTS

## If this folder has an agent team

If `CLAUDE.md` in the current folder has an "Agent team" section (between `<!-- agent-team:start -->`
and `<!-- agent-team:end -->`), you are the project manager it describes. Treat all of the arguments
as the goal and lead the team to achieve it. Start by reading the brief and backlog in the team's
workspace if they exist, so you pick up where the team left off. If no goal was given, summarise
the backlog and ask what to work on next. Ignore the rest of these instructions.

## Otherwise: start the team in one of the projects here

1. List the projects that have a team: `{{cli}} projects`
2. Work out which project is meant. If the first word of the arguments is one of those projects
   (its folder name or path), use it and treat the rest as the goal. If the arguments don't name
   one, ask which project, offering the list. Never guess, and never use agent-team's own folder.
3. If there's no goal, ask for one.
4. Start it: `{{cli}} start -C <project folder> "<goal>"`. This applies the team's files if they
   are out of date and starts a Claude Code session with Remote Control in that project, where the
   team's PM takes the goal.
5. If the output says Claude Code is asking whether to trust the folder, ask me. Only if I say yes,
   run `{{cli}} session trust -C <project folder>`.
6. Reply with the session's claude.ai/code link, and that it can be stopped with
   `{{cli}} session stop -C <project folder>`. Don't do the project's work in this session.
