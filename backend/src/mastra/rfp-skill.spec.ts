import { readFileSync } from 'fs';
import { join } from 'path';
import { parseLinks } from './agent-links';
import {
  AGENT_SKILLS,
  HARNESS_SKILLS,
  agentSkillsView,
  builtInOnDemandSkillNames,
  catalogSkills,
  loadAppSkills,
  skillBody,
  skillsRoot,
  validateAgentSkills,
} from './app-skills';
import { rfpTools } from './tools/rfp.tools';

/**
 * The RFP Builder's stage skills (agents.md 7.4), one per stage in stage
 * order, checked as the backend checks them at start. Each keeps the tools,
 * row format and save step of its stage.
 */
const STAGE_SKILLS: [string, string[]][] = [
  [
    'rfp-client-renewal',
    [
      'list_clients',
      'get_client_renewals',
      'create_rfp',
      'list_rfps',
      'get_rfp',
      'stage=1',
    ],
  ],
  [
    'rfp-current-program',
    [
      'get_client_program',
      'get_client_financials',
      'get_client_census',
      'get_client_commercials',
      'clientBackground',
      'stage=2',
    ],
  ],
  [
    'rfp-market-scope',
    [
      'get_marketing_history',
      'list_reference_data',
      'set_rfp_lines',
      'scopeStatement',
      'stage=3',
      '<line> | as-is|alternate | <plan design ids, comma-separated, or all> | <alternate funding or -> | <alternate plan type or -> | <notes>',
    ],
  ],
  [
    'rfp-carriers',
    [
      'list_carriers',
      'set_rfp_carriers',
      'stage=4',
      '<carrier name> | <lines, comma-separated> | incumbent yes|no | <contact email or -> | <notes>',
    ],
  ],
  [
    'rfp-requirements',
    [
      'set_rfp_requirements',
      'stage=5',
      '<section> | <question> | required yes|no | text|yes_no|number|table|attachment',
    ],
  ],
  [
    'rfp-timeline',
    [
      'set_rfp_timeline',
      'stage=6',
      '<milestone> | <YYYY-MM-DD> | <owner> | <notes>',
      'K+30',
      'E−45',
    ],
  ],
  [
    'rfp-package',
    [
      'get_rfp',
      'executiveSummary',
      'instructionsToBidders',
      'evaluationCriteria',
      "status='ready'",
      'stage=7',
      'export_rfp_package',
      'show_in_panel',
    ],
  ],
];
const NAMES = STAGE_SKILLS.map(([name]) => name);

const document = (name: string) =>
  readFileSync(join(skillsRoot(), name, 'SKILL.md'), 'utf8');

/** The tools a body names in backticks, as a call or a name. */
function toolsNamed(body: string): string[] {
  return Object.keys(rfpTools).filter((tool) =>
    new RegExp(`\`${tool}\\b`).test(body),
  );
}

describe("the RFP Builder's stage skills (agents.md 7.3, 7.4)", () => {
  it('are its on-demand skills, in stage order, and pass the start-up skill check', () => {
    expect(AGENT_SKILLS.rfp).toEqual(NAMES);
    const skills = loadAppSkills(skillsRoot());
    expect(() => validateAgentSkills(skills, AGENT_SKILLS)).not.toThrow();
    expect(() => validateAgentSkills(skills, HARNESS_SKILLS)).not.toThrow();
    expect(skills.has('rfp-process')).toBe(false);

    NAMES.forEach((name, n) => {
      expect(skills.get(name)).toMatchObject({
        name,
        loading: 'on-demand',
        agents: ['rfp'],
      });
      // The description names its stage, so the model loads the right one.
      expect(skills.get(name)?.description).toMatch(
        new RegExp(`^Use when .*at stage ${n + 1} \\(`),
      );
    });
  });

  it("ships each SKILL.md's front matter as agents.md 7.4 lists it", () => {
    const spec = readFileSync(
      join(__dirname, '..', '..', '..', 'specs', 'system', 'agents.md'),
      'utf8',
    );
    for (const name of NAMES) {
      const frontMatter = /^---\n[\s\S]*?\n---\n/.exec(document(name))?.[0];
      expect(frontMatter).toBeDefined();
      expect(spec).toContain(frontMatter as string);
    }
  });

  it.each(STAGE_SKILLS)(
    '%s keeps its tools, row format and save step, and links every tool it names',
    (name, mentions) => {
      const text = document(name);
      const body = skillBody(text);
      const lines = body.split('\n').length;
      expect(lines).toBeGreaterThanOrEqual(40);
      expect(lines).toBeLessThanOrEqual(90);
      for (const mention of mentions) expect(body).toContain(mention);
      // The "Tools for this stage" line links exactly the tools the body uses.
      const links = parseLinks(body);
      expect(links.skills).toEqual([]);
      expect([...links.tools].sort()).toEqual(toolsNamed(body).sort());
      for (const tool of links.tools) {
        expect(Object.keys(rfpTools)).toContain(tool);
      }
    },
  );

  it('reach the RFP Builder only', () => {
    expect(catalogSkills('rfp').map((skill) => skill.name)).toEqual(
      [...NAMES].sort(),
    );
    const assistant = catalogSkills('assistant').map((skill) => skill.name);
    // A prompt or a user agent linking one would name a skill the assistant lacks.
    const linkable = builtInOnDemandSkillNames();
    for (const name of NAMES) {
      expect(assistant).not.toContain(name);
      expect(linkable).not.toContain(name);
    }
    expect(agentSkillsView('rfp').skills).toEqual(
      [...NAMES].sort().map((name): unknown =>
        expect.objectContaining({
          name,
          level: 'built-in',
          loading: 'on-demand',
          files: [expect.objectContaining({ path: 'SKILL.md' })],
        }),
      ),
    );
  });
});
