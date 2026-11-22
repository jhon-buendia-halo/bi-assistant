/**
 * An agent's playbooks, read from its playbooks skill (ui.md 4.5, *CV view*,
 * *Playbooks*): a skill named `<agent>-playbooks` whose `SKILL.md` is the
 * router (which playbook to read, and when) and whose `reference/*.md` files
 * are the playbooks, each ending with its `**Reply:**`. Pure functions.
 */

/** When the agent reads a playbook: before her first call, or when something happens. */
export type PlaybookPhase = 'first' | 'during';

export interface Playbook {
  /** `reference/ranking.md`. */
  path: string;
  /** Its `# ` heading: `Ranking`. */
  title: string;
  /** What sends the agent to it, in the router's words; '' when the router does not name it. */
  trigger: string;
  phase: PlaybookPhase | null;
  /** Its steps, as Markdown (the file without its heading and Reply). */
  body: string;
  /** Its top-level steps or cases. */
  steps: number;
  /** What the agent's reply must say; '' without one. */
  reply: string;
}

export interface PlaybookSet {
  /** The skill they come from: `avery-playbooks`. */
  skill: string;
  playbooks: Playbook[];
  /** The router's other choices before the first call (no playbook): `Score 0–1 … → no playbook …`. */
  notes: string[];
}

/** A playbooks skill: its name ends in `-playbooks`. */
export function isPlaybooksSkill(name: string): boolean {
  return name.endsWith('-playbooks');
}

const REFERENCE = /reference\/[\w.-]+\.md/;

/** What sends the agent to each playbook, and the router's notes, from `SKILL.md`. */
export function readRouter(skillMd: string): {
  routes: { path: string; trigger: string; phase: PlaybookPhase }[];
  notes: string[];
} {
  const routes: { path: string; trigger: string; phase: PlaybookPhase }[] = [];
  const notes: string[] = [];
  let heading = '';
  for (const raw of skillMd.split('\n')) {
    const line = raw.trimEnd();
    if (line.startsWith('## ')) {
      heading = line.slice(3).toLowerCase();
      continue;
    }
    if (!line.startsWith('- ')) continue;
    const picking = heading.startsWith('pick');
    const during = /during|happens/.test(heading);
    if (!picking && !during) continue;
    const text = line.slice(2).trim();
    const path = REFERENCE.exec(text)?.[0];
    if (path) {
      const trigger = text.split('→')[0].trim();
      routes.push({ path, trigger, phase: during ? 'during' : 'first' });
    } else if (picking) {
      notes.push(text);
    }
  }
  return { routes, notes };
}

/** One playbook file: its heading, steps and Reply. */
export function readPlaybook(
  path: string,
  content: string,
): Omit<Playbook, 'trigger' | 'phase'> {
  const lines = content.split('\n');
  const headingAt = lines.findIndex((line) => line.startsWith('# '));
  const title =
    headingAt >= 0
      ? lines[headingAt].slice(2).trim()
      : (path.split('/').pop() ?? path).replace(/\.md$/, '');
  let reply = '';
  const rest: string[] = [];
  lines.forEach((line, i) => {
    if (i === headingAt) return;
    const said = /^\*\*Reply:\*\*\s*(.*)$/.exec(line.trim());
    if (said) reply = said[1].trim();
    else rest.push(line);
  });
  const body = rest.join('\n').trim();
  const steps = rest.filter((line) => /^(\d+\.|-)\s/.test(line)).length;
  return { path, title, body, steps, reply };
}

/**
 * The playbooks in the router's order (those read before the first call,
 * then those read when something happens), any file the router does not
 * name last.
 */
export function playbookSet(
  skill: string,
  skillMd: string,
  files: readonly { path: string; content: string }[],
): PlaybookSet {
  const { routes, notes } = readRouter(skillMd);
  const read = new Map(
    files.map((file) => [file.path, readPlaybook(file.path, file.content)]),
  );
  const playbooks: Playbook[] = [];
  const order = [
    ...routes.filter((route) => route.phase === 'first'),
    ...routes.filter((route) => route.phase === 'during'),
  ];
  for (const route of order) {
    const playbook = read.get(route.path);
    if (!playbook || playbooks.some((p) => p.path === route.path)) continue;
    playbooks.push({ ...playbook, trigger: route.trigger, phase: route.phase });
  }
  for (const [path, playbook] of read) {
    if (!playbooks.some((p) => p.path === path)) {
      playbooks.push({ ...playbook, trigger: '', phase: null });
    }
  }
  return { skill, playbooks, notes };
}
