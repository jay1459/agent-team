/** Errors (as "path: message") that belong to a path or anything inside it. */
export function errorsUnder(errors: string[], prefix: string): string[] {
  return errors.filter((e) => e.startsWith(`${prefix}.`) || e.startsWith(`${prefix}:`));
}
