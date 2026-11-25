/** Errors (as "path: message") that belong to a path or anything inside it. */
export function errorsUnder(errors: string[], prefix: string): string[] {
  return errors.filter((e) => e.startsWith(`${prefix}.`) || e.startsWith(`${prefix}:`));
}

/** A git remote worth recording in team.json: https/ssh only, with any credentials removed. */
export function shareableRemote(remote: string | undefined): string | undefined {
  return remote && /^(https:\/\/|ssh:\/\/|git@)\S+$/.test(remote)
    ? remote.replace(/^https:\/\/[^@/]+@/, "https://")
    : undefined;
}
