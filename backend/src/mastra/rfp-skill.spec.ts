import { readFileSync } from 'fs';
import { join } from 'path';
import {
  AGENT_SKILLS,
  HARNESS_SKILLS,
  agentSkillsView,
  builtInOnDemandSkillNames,
  catalogSkills,
  loadAppSkills,
  skillsRoot,
  validateAgentSkills,
} from './app-skills';

/** The `rfp-process` skill (agents.md 7.4), checked as the backend checks it at start. */
const SKILL_DIR = join(skillsRoot(), 'rfp-process');

const STAGE_FILES: Record<string, string[]> = {
  '1-client-and-renewal.md': [
    'list_clients',
    'get_client_renewals',
    'create_rfp',
    'list_rfps',
    'get_rfp',
    'stage=1',
  ],
  '2-current-program.md': [
    'get_client_program',
    'get_client_financials',
    'get_client_census',
    'get_client_commercials',
    'clientBackground',
    'stage=2',
  ],
  '3-market-scope.md': [
    'get_marketing_history',
    'list_reference_data',
    'set_rfp_lines',
    'scopeStatement',
    'stage=3',
    '<line> | as-is|alternate | <plan design ids, comma-separated, or all> | <alternate funding or -> | <alternate plan type or -> | <notes>',
  ],
  '4-carriers.md': [
    'list_carriers',
    'set_rfp_carriers',
    'stage=4',
    '<carrier name> | <lines, comma-separated> | incumbent yes|no | <contact email or -> | <notes>',
  ],
  '5-requirements.md': [
    'set_rfp_requirements',
    'stage=5',
    '<section> | <question> | required yes|no | text|yes_no|number|table|attachment',
  ],
  '6-timeline.md': [
    'set_rfp_timeline',
    'stage=6',
    '<milestone> | <YYYY-MM-DD> | <owner> | <notes>',
    'K+30',
    'E−45',
  ],
  '7-package.md': [
    'get_rfp',
    'executiveSummary',
    'instructionsToBidders',
    'evaluationCriteria',
    "status='ready'",
    'stage=7',
    'export_rfp_package',
  ],
};

/** agents.md 7.4's `SKILL.md`, verbatim. */
function specSkillDocument(): string {
  const spec = readFileSync(
    join(__dirname, '..', '..', '..', 'specs', 'system', 'agents.md'),
    'utf8',
  );
  const at = spec.indexOf('**The `rfp-process` skill**');
  const start = spec.indexOf('```\n', at) + 4;
  const end = spec.indexOf('\n```', start);
  return `${spec.slice(start, end)}\n`;
}

describe('the rfp-process skill (agents.md 7.3, 7.4)', () => {
  it('passes the start-up skill check', () => {
    const skills = loadAppSkills(skillsRoot());
    expect(() => validateAgentSkills(skills, AGENT_SKILLS)).not.toThrow();
    expect(() => validateAgentSkills(skills, HARNESS_SKILLS)).not.toThrow();

    const skill = skills.get('rfp-process');
    expect(skill).toMatchObject({
      name: 'rfp-process',
      loading: 'on-demand',
      agents: ['rfp'],
    });
    expect(skill?.description.startsWith('Use when')).toBe(true);
  });

  it('ships the SKILL.md of agents.md 7.4 verbatim', () => {
    expect(readFileSync(join(SKILL_DIR, 'SKILL.md'), 'utf8')).toBe(
      specSkillDocument(),
    );
  });

  it.each(Object.entries(STAGE_FILES))(
    'reference/%s is 40-80 lines and keeps its tools, row format and save step',
    (file, mentions) => {
      const text = readFileSync(join(SKILL_DIR, 'reference', file), 'utf8');
      const lines = text.trimEnd().split('\n').length;
      expect(lines).toBeGreaterThanOrEqual(40);
      expect(lines).toBeLessThanOrEqual(80);
      for (const mention of mentions) expect(text).toContain(mention);
    },
  );

  it('reaches the RFP Builder only', () => {
    expect(catalogSkills('rfp').map((skill) => skill.name)).toEqual([
      'rfp-process',
    ]);
    expect(catalogSkills('assistant').map((skill) => skill.name)).not.toContain(
      'rfp-process',
    );
    // A prompt or a user agent linking it would name a skill the assistant lacks.
    expect(builtInOnDemandSkillNames()).not.toContain('rfp-process');
    expect(agentSkillsView('rfp').skills).toEqual([
      expect.objectContaining({
        name: 'rfp-process',
        level: 'built-in',
        loading: 'on-demand',
      }),
    ]);
  });
});
