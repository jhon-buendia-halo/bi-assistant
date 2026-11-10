export type PersonaExpertise = 'novice' | 'intermediate' | 'expert';

/** Who asks the questions (roadmap 1.21.6). Stored by the backend's /personas. */
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

export type PersonaInput = Omit<UserPersona, 'id' | 'createdAt' | 'updatedAt'>;

/** Client-side limits; they mirror the backend's validation. */
export const PERSONA_LIMITS = {
  name: 80,
  role: 80,
  description: 2000,
  goals: 2000,
  answerStyle: 500,
  typicalQuestions: 10,
  typicalQuestion: 300,
} as const;

export const PERSONA_EXPERTISE: { value: PersonaExpertise; label: string }[] = [
  { value: 'novice', label: 'Novice' },
  { value: 'intermediate', label: 'Intermediate' },
  { value: 'expert', label: 'Expert' },
];

export function expertiseLabel(expertise: PersonaExpertise): string {
  return PERSONA_EXPERTISE.find((e) => e.value === expertise)?.label ?? expertise;
}

/** Chip class per expertise level (components.css `.chip-*`). */
export function expertiseChipClass(expertise: PersonaExpertise): string {
  switch (expertise) {
    case 'novice':
      return 'chip-neutral';
    case 'intermediate':
      return 'chip-info';
    case 'expert':
      return 'chip-success';
    default:
      return 'chip-neutral';
  }
}
