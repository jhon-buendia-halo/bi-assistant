import { z } from 'zod';

/** Step 1 — the investigation plan the job then works through. */
export const analysisPlanSchema = z.object({
  title: z
    .string()
    .describe('Short report title (under 80 characters), no markdown'),
  angles: z
    .array(
      z.object({
        title: z
          .string()
          .describe('Short label for this angle, e.g. "Denials by payer"'),
        question: z
          .string()
          .describe(
            'The precise sub-question this angle answers with SQL over the session entities',
          ),
      }),
    )
    .min(1)
    .describe('Between 3 and 5 distinct, non-overlapping investigation angles'),
});

/** Step 3 — the written report, split so the chat can show the summary alone. */
export const analysisReportSchema = z.object({
  title: z.string().describe('Report title, no markdown heading marks'),
  executiveSummary: z
    .string()
    .describe(
      'Markdown: 3-6 sentences or bullets a decision-maker can act on, with the key numbers',
    ),
  report: z
    .string()
    .describe(
      'Markdown body starting at "## Findings by angle"; no executive summary and no data appendix — those are added around it',
    ),
});

export type AnalysisPlan = z.infer<typeof analysisPlanSchema>;
export type AnalysisReportOutput = z.infer<typeof analysisReportSchema>;
