/**
 * The one built-in user (ADR-0030): always the caller, never signed in. The id
 * stays `local`, so documents stamped by M13 and the former `*:local` settings
 * keys needed no second rewrite.
 */
export const SUPER_ADMIN = Object.freeze({
  id: 'local',
  displayName: 'Super admin',
});
