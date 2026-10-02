/**
 * ADR-0007 / roadmap 1.2.2's hard constraint: the assistant must never see a
 * physical table name or a dialect word. This asserts it two ways — the
 * static instructions, and the rendered model block a real turn would see
 * for the World Cup fixture — so the guarantee holds for both halves of
 * what actually reaches the model in a turn's system context.
 *
 * Deliberately does NOT import `assistant.agent.ts` (or anything from
 * `@mastra/core/agent`): that drags in ESM-only transitive dependencies
 * (`@sindresorhus/slugify`, via `@mastra/core`'s agent build) Jest's
 * CommonJS runtime cannot load — see `agent-constants.ts`'s header for the
 * same constraint elsewhere in this codebase. `ASSISTANT_INSTRUCTIONS` is
 * split into its own plain-TS module (`assistant.instructions.ts`) for
 * exactly this reason; `model.tools.ts` only imports `@mastra/core/tools`,
 * which loads fine under Jest.
 */
import { worldCupFixture } from '../../modules/data-models/dsl/__fixtures__/world-cup.fixture';
import {
  composeSessionModel,
  renderModelBlock,
} from '../../modules/data-models/session-model';
import { ASSISTANT_INSTRUCTIONS } from './assistant.instructions';
import { modelTools } from '../tools/model.tools';

const BANNED_PATTERNS: RegExp[] = [
  /\bcatalog\b/i,
  /\bschema\.\w+\.\w+\b/i, // a fully-qualified `catalog.schema.table` shape
  /\bpostgresql\b/i,
  /\bpostgres\b/i,
  /\bdatabricks\b/i,
  /\bsqlite\b/i,
  /sql dialect/i,
];

function assertNoBannedVocabulary(text: string): void {
  for (const pattern of BANNED_PATTERNS) {
    expect(pattern.test(text)).toBe(false);
  }
}

describe('assistant instructions', () => {
  it('never mentions a catalog/schema/table key or a dialect name', () => {
    assertNoBannedVocabulary(ASSISTANT_INSTRUCTIONS);
  });

  it('exposes only the logical-query-layer tools, not the legacy dataset tools', () => {
    const names = Object.keys(modelTools);
    expect(names).toEqual(
      expect.arrayContaining([
        'list_entities',
        'describe_entity',
        'query_entities',
        'sample_records',
        'run_raw_sql',
      ]),
    );
    expect(names).not.toEqual(
      expect.arrayContaining(['run_readonly_sql', 'sample_rows']),
    );
  });
});

describe('renderModelBlock vocabulary (World Cup fixture)', () => {
  it('never mentions a physical table key or a dialect name', () => {
    const sessionModel = composeSessionModel([
      { dataset: 'World Cup Core', model: worldCupFixture() },
    ]);
    const block = renderModelBlock(sessionModel);
    assertNoBannedVocabulary(block);
    // Positive check: the block is not empty prose — it actually describes
    // the fixture's entities in logical terms.
    expect(block).toContain('matches');
    expect(block).toContain('avg_attendance');
  });
});
