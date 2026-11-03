import { notImplemented } from './not-implemented';

export interface JoinTableShape {
  namespace: string;
  name: string;
  columns: string[];
}

export interface JoinCandidate {
  schema: string;
  table: string;
  column: string;
  refSchema: string;
  refTable: string;
  refColumn: string;
}

export const MAX_INFERRED_JOIN_CANDIDATES = 20;

/** Name-matched join candidates (unit 3, BA-254). `declaredKeys` holds "schema table column". */
export function inferJoinCandidates(
  childTables: JoinTableShape[],
  allTables: JoinTableShape[],
  declaredKeys: Set<string>,
): JoinCandidate[] {
  void childTables;
  void allTables;
  void declaredKeys;
  return notImplemented('inferJoinCandidates');
}
