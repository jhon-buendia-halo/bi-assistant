export const PERSONA_EXPERTISE_LEVELS = [
  'novice',
  'intermediate',
  'expert',
] as const;

export type PersonaExpertise = (typeof PERSONA_EXPERTISE_LEVELS)[number];

/** A user persona: who asks the questions, so the app can tailor answers. */
export interface UserPersona {
  id: string;
  name: string;
  role: string;
  description: string;
  goals: string;
  typicalQuestions: string[];
  expertise: PersonaExpertise;
  answerStyle: string;
  createdAt: string;
  updatedAt: string;
}

/** Everything a caller supplies; the server owns `id` and the timestamps. */
export type UserPersonaInput = Omit<
  UserPersona,
  'id' | 'createdAt' | 'updatedAt'
>;
