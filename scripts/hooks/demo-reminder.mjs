// Claude Code PreToolUse hook (Bash|PowerShell), registered in .claude/settings.json.
// When a command starts the web app (backend/dist/cli.js) from a worktree and a
// story in progress has no demo yet, it reminds the session to record and
// publish the demo before handing the app to the user (workflow-strict fast loop,
// delivery.md 13). It never blocks the command and stays silent on any error.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { storiesWithoutDemo } from '../qa-lib.mjs';

function findRoot(start) {
  // Git Bash reports /c/Users/...; Node on Windows needs C:/Users/...
  const native = process.platform === 'win32' ? start.replace(/^\/([a-z])\//i, '$1:/') : start;
  let dir = path.resolve(native);
  for (;;) {
    if (fs.existsSync(path.join(dir, 'roadmap.md')) && fs.existsSync(path.join(dir, 'scripts', 'qa.mjs'))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

try {
  const input = JSON.parse(fs.readFileSync(0, 'utf8') || '{}');
  const command = String(input.tool_input?.command ?? '');
  if (!/dist[\\/]+cli\.js/.test(command) || /--help\b/.test(command)) process.exit(0);
  const root = findRoot(input.cwd || process.env.CLAUDE_PROJECT_DIR || process.cwd());
  if (!root || !/[\\/]\.claude[\\/]worktrees[\\/]/.test(root + path.sep)) process.exit(0);
  // Only the stories this branch marked in progress: its roadmap diff against main.
  const git = (args) => spawnSync('git', args, { cwd: root, encoding: 'utf8' });
  const base = git(['merge-base', 'HEAD', 'main']).stdout?.trim();
  if (!base) process.exit(0);
  const roadmap = git(['diff', base, '--', 'roadmap.md']).stdout ?? '';
  const ids = storiesWithoutDemo(roadmap, (rel) => fs.existsSync(path.join(root, rel)));
  if (!ids.length) process.exit(0);
  const text =
    `No demo yet for ${ids.join(', ')}. Before handing the app to the user, run ` +
    ids.map((id) => `node scripts/qa.mjs ${id} --fast`).join(', ') +
    ' (write the story\'s main scenario tagged @demo @story-<id> first for a UI story), then node scripts/demo-page.mjs <id> and publish the page as a Claude artifact (workflow-strict fast loop).';
  process.stdout.write(JSON.stringify({
    systemMessage: `Demo reminder: ${text}`,
    hookSpecificOutput: { hookEventName: 'PreToolUse', additionalContext: text },
  }));
} catch {
  // A reminder must never get in the way.
}
process.exit(0);
