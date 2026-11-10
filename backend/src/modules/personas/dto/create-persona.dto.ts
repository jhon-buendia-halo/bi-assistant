import type { PersonaExpertise } from '../entities/user-persona.entity';

/** Create payload for a user persona. Validated in `PersonasService`. */
export class CreatePersonaDto {
  name: string;
  role?: string;
  description?: string;
  goals?: string;
  typicalQuestions?: string[];
  expertise?: PersonaExpertise;
  answerStyle?: string;
}
