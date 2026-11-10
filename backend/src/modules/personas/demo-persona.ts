import type { UserPersonaInput } from './entities/user-persona.entity';

/**
 * The `settings` key recording that the default personas were seeded into
 * this data dir (data-model 3.9a). Its presence stops the seed from running
 * again, so a deleted demo persona stays deleted.
 */
export const PERSONAS_SEED_KEY = 'personas-seed';

/** The persona every new data dir starts with (user-personas R13). */
export const DEMO_PERSONA: UserPersonaInput = {
  name: 'Demo Finance Analyst',
  role: 'FP&A analyst',
  description:
    'A demo persona that ships with the app. Works in financial planning and analysis, reviews healthcare benefit costs every month and prepares the numbers finance leadership sees. Comfortable with spreadsheets and pivot tables, not with SQL.',
  goals:
    'Explain month-over-month changes in medical and pharmacy spend, find the plans, carriers and cost drivers behind budget variances, and back every forecast with numbers that can be traced to the source data.',
  typicalQuestions: [
    'What was total medical and pharmacy spend by month over the last 12 months?',
    'Which plans or carriers are over budget this year, and by how much?',
    'What is our per-member-per-month (PMPM) cost, and how has it trended?',
    'Which claim categories drove the change in spend versus last quarter?',
    'How do actual costs compare with the forecast for this plan year?',
  ],
  expertise: 'intermediate',
  answerStyle:
    'Lead with the headline number and its change versus the prior period, then a short table. Show amounts in US dollars with thousands separators, state the period and filters used, and keep the explanation to two or three sentences.',
};
