import { OFFICIAL_AGENT_KEYS, SYSTEM_AGENT_KEYS } from './agent-constants';
import {
  AGENT_DOMAINS,
  BUILTIN_AGENT_PERSONAS,
  builtinAgentPersona,
  isAgentDomain,
} from './agent-personas';

describe('built-in agent personas (agents.md 1.1)', () => {
  const keys = [...OFFICIAL_AGENT_KEYS, ...SYSTEM_AGENT_KEYS];

  it('gives every built-in agent a human name and a job title', () => {
    for (const key of keys) {
      const persona = builtinAgentPersona(key);
      expect(persona?.name).toMatch(/^[A-Z][a-z]+$/);
      expect(persona?.role.length).toBeGreaterThan(0);
    }
  });

  it('gives every built-in agent a short first-person intro', () => {
    for (const key of keys) {
      const intro = builtinAgentPersona(key)?.intro ?? '';
      // Speaks as the agent ("I …", "I'm …"), not about it.
      expect(intro).toMatch(/\b(I|I'm|I'll|me)\b/);
      expect(intro.length).toBeGreaterThan(40);
      expect(intro.length).toBeLessThanOrEqual(160);
    }
  });

  it('lists no persona for an agent that is not registered', () => {
    expect(Object.keys(BUILTIN_AGENT_PERSONAS).sort()).toEqual(
      [...keys].sort(),
    );
    expect(builtinAgentPersona('rfp')).toBeUndefined();
  });

  it('never gives two agents the same name', () => {
    const names = Object.values(BUILTIN_AGENT_PERSONAS).map((p) => p.name);
    expect(new Set(names).size).toBe(names.length);
    expect(builtinAgentPersona('image-reader')).toMatchObject({
      name: 'Zoe',
      role: 'Image Analyst',
      domain: 'storytelling',
    });
  });

  it('groups the built-in agents into their domains, none General', () => {
    const byDomain: Record<string, string[]> = {};
    for (const [key, persona] of Object.entries(BUILTIN_AGENT_PERSONAS)) {
      (byDomain[persona.domain] ??= []).push(key);
    }
    for (const list of Object.values(byDomain)) list.sort();
    expect(byDomain).toEqual({
      'data-foundations': [
        'data-mapper',
        'data-readiness',
        'knowledge-bootstrap',
      ],
      analysis: ['analysis-planner', 'assistant', 'insights-analyst'],
      sql: ['query-explainer', 'sql-fixer', 'sql-verifier'],
      storytelling: [
        'answer-writer',
        'dashboard-reader',
        'image-reader',
        'visualization',
      ],
      quality: ['assistant-eval-judge', 'site-reviewer'],
    });
  });

  it('knows the domain ids, General last', () => {
    expect(AGENT_DOMAINS.at(-1)).toBe('general');
    expect(isAgentDomain('sql')).toBe(true);
    expect(isAgentDomain('finance')).toBe(false);
    expect(isAgentDomain(undefined)).toBe(false);
  });
});
