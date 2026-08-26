/**
 * Who a token belongs to. Shared with the server (which imports this file
 * directly, hence the .ts specifiers on its side), so the two can never
 * disagree on the set of roles.
 *
 * 'owner' is the deployment's own player: full access, the historical
 * behaviour. 'guest' is a read-only share link (see server/auth.ts) handed to
 * someone who should be able to browse the catalog, open a score and look at
 * the practice history, but never write anything back.
 */
export type ApiRole = 'owner' | 'guest'
