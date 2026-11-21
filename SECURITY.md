# Security

Please report security problems privately, through GitHub's
[private vulnerability reporting](https://github.com/jay1459/agent-team/security/advisories/new),
rather than in a public issue.

Things that matter most here:

- the local UI server (`agent-team ui`): token checks, file paths, anything that lets another page
  or another user on the network change a project
- anything that would let `team.json`, a profile or a catalog file carry or leak a secret
- generated files that grant agents more access than the config says
