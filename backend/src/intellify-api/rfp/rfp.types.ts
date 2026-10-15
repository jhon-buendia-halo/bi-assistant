/** Wire shapes of the RFP records (api.md 2.16.4). */

export const RFP_STATUSES = ['draft', 'ready', 'issued', 'closed'] as const;
export type RfpStatus = (typeof RFP_STATUSES)[number];

export const SECTION_KEYS = [
  'executiveSummary',
  'clientBackground',
  'scopeStatement',
  'instructionsToBidders',
  'evaluationCriteria',
  'notes',
] as const;
export type SectionKey = (typeof SECTION_KEYS)[number];
export type RfpSections = Partial<Record<SectionKey, string>>;

export const MARKET_BASES = ['as-is', 'alternate'] as const;
export type MarketBasis = (typeof MARKET_BASES)[number];

export const ANSWER_TYPES = [
  'text',
  'yes_no',
  'number',
  'table',
  'attachment',
] as const;
export type AnswerType = (typeof ANSWER_TYPES)[number];

export const MIN_PLAN_YEAR = 2024;
export const MAX_PLAN_YEAR = 2035;
export const MIN_STAGE = 0;
export const MAX_STAGE = 7;

interface RfpHeader {
  id: string;
  clientOneCode: string;
  clientName: string;
  title: string;
  planYear: number;
  effectiveDate: string;
  status: RfpStatus;
  /** 0..7, the last completed stage. */
  stage: number;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
  /** The client is no longer in `intellify.clients` (e.g. after a reseed). */
  clientMissing?: true;
}

export interface RfpSummary extends RfpHeader {
  lines: number;
  carriers: number;
  requirements: number;
  milestones: number;
}

export interface RfpLine {
  id: string;
  position: number;
  /** Product name, e.g. `Medical`. */
  line: string;
  productId: string;
  planDesignIds: string[];
  marketBasis: MarketBasis;
  alternateFunding?: string;
  alternatePlanType?: string;
  notes?: string;
}

export interface RfpCarrier {
  id: string;
  position: number;
  insurerId: string;
  insurerName: string;
  lines: string[];
  incumbent: boolean;
  contactEmail?: string;
  notes?: string;
}

export interface RfpRequirement {
  id: string;
  position: number;
  section: string;
  question: string;
  required: boolean;
  answerType: AnswerType;
}

export interface RfpMilestone {
  id: string;
  position: number;
  milestone: string;
  dueDate: string;
  owner?: string;
  notes?: string;
}

export interface Rfp extends RfpHeader {
  sections: RfpSections;
  lines: RfpLine[];
  carriers: RfpCarrier[];
  requirements: RfpRequirement[];
  timeline: RfpMilestone[];
}

/** Rows ready to insert (ids and positions are assigned by the store). */
export type NewRfpLine = Omit<RfpLine, 'id' | 'position'>;
export type NewRfpCarrier = Omit<RfpCarrier, 'id' | 'position'>;
export type NewRfpRequirement = Omit<RfpRequirement, 'id' | 'position'>;
export type NewRfpMilestone = Omit<RfpMilestone, 'id' | 'position'>;
