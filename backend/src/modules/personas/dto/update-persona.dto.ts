import type { PersonaExpertise } from '../entities/user-persona.entity';

/** Partial update: omitted fields keep their value. */
export class UpdatePersonaDto {
  name?: string;
  role?: string;
  description?: string;
  goals?: string;
  typicalQuestions?: string[];
  expertise?: PersonaExpertise;
  answerStyle?: string;
}
