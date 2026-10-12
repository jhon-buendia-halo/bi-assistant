/**
 * The five local personas (admin R69; ADR-0012): the directory users local
 * mode seeds at startup, with fixed ids. Demo User keeps the id `local`, so
 * the data stored before local mode had sign-in stays theirs (M13).
 */
export interface LocalPersona {
  id: string;
  /** Lowercased; also the email. Demo User's is the bootstrap admin (R18). */
  userName: string;
  displayName: string;
  givenName: string;
  familyName: string;
  /** A role seeded once on first start (data-model 3.2.2). */
  seedRole?: 'maker' | 'approver';
  /** Made Data owner of every datasource, once each (admin R69, R72). */
  seedDataOwner?: true;
}

export const LOCAL_PERSONAS: readonly LocalPersona[] = Object.freeze([
  {
    id: 'local',
    userName: 'demo@local.test',
    displayName: 'Demo User',
    givenName: 'Demo',
    familyName: 'User',
  },
  {
    id: 'local-uma',
    userName: 'uma@local.test',
    displayName: 'Uma User',
    givenName: 'Uma',
    familyName: 'User',
  },
  {
    id: 'local-mark',
    userName: 'mark@local.test',
    displayName: 'Mark Maker',
    givenName: 'Mark',
    familyName: 'Maker',
    seedRole: 'maker',
  },
  {
    id: 'local-dana',
    userName: 'dana@local.test',
    displayName: 'Dana Data Owner',
    givenName: 'Dana',
    familyName: 'Data Owner',
    seedDataOwner: true,
  },
  {
    id: 'local-avery',
    userName: 'avery@local.test',
    displayName: 'Avery Approver',
    givenName: 'Avery',
    familyName: 'Approver',
    seedRole: 'approver',
  },
]);

/** Demo User's user name: the only bootstrap admin of local mode (R18). */
export const DEMO_USER_NAME = 'demo@local.test';

/** Whether `userId` is a local persona (never deactivated or deleted, R69). */
export const isLocalPersona = (userId: string): boolean =>
  LOCAL_PERSONAS.some((p) => p.id === userId);
