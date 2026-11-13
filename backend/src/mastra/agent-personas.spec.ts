import { OFFICIAL_AGENT_KEYS, SYSTEM_AGENT_KEYS } from './agent-constants';
import { BUILTIN_AGENT_PERSONAS, builtinAgentPersona } from './agent-personas';

describe('built-in agent personas (agents.md 1.1)', () => {
  const keys = [...OFFICIAL_AGENT_KEYS, ...SYSTEM_AGENT_KEYS];

  it('gives every built-in agent a human name and a job title', () => {
    for (const key of keys) {
      const persona = builtinAgentPersona(key);
      expect(persona?.name).toMatch(/^[A-Z][a-z]+$/);
      expect(persona?.role.length).toBeGreaterThan(0);
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
  });
});
