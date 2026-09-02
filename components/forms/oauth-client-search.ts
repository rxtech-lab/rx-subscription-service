import type { OAuthClientOption } from "@/lib/console/session";

/**
 * Which clients a query offers, and in what order.
 *
 * Split out of the combobox so the matching rule is testable without a DOM.
 * Already-selected clients are dropped rather than shown greyed out: the list
 * is a menu of what you can still add, and an entry that does nothing when
 * clicked is worse than no entry.
 */
export function matchOAuthClients(
  clients: OAuthClientOption[],
  query: string,
  selected: readonly string[],
): OAuthClientOption[] {
  const needle = query.trim().toLocaleLowerCase();
  return clients.filter((client) => {
    if (selected.includes(client.id)) return false;
    if (!needle) return true;
    return (
      client.id.toLocaleLowerCase().includes(needle) ||
      client.name.toLocaleLowerCase().includes(needle)
    );
  });
}

/**
 * Whether to offer the typed text as a literal client id.
 *
 * Only when it names nothing already on offer, so the escape hatch never
 * competes with a real result — and never for a client that is already
 * selected, which would silently do nothing.
 */
export function canUseRawClientId(
  clients: OAuthClientOption[],
  query: string,
  selected: readonly string[],
): boolean {
  const raw = query.trim();
  if (!raw) return false;
  if (selected.includes(raw)) return false;
  return !clients.some((client) => client.id === raw);
}
