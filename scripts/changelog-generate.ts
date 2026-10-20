import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { classifyChange, isAutomationChange, renderChangelog, renderHistory, replaceGeneratedBlock, type ChangeRecord } from './changelog.js';

const root = resolve(import.meta.dirname, '..');
const mode = process.argv.includes('--check') ? 'check' : 'write';
const repository = process.env.GITHUB_REPOSITORY ?? 'Jam3sl1u/Chariot';
const server = (process.env.GITHUB_SERVER_URL ?? 'https://github.com').replace(/\/$/, '');

function git(...args: string[]): string {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trimEnd();
}

type Commit = { sha: string; timestamp: string; subject: string };
function commits(): Commit[] {
  const output = git('log', 'main', '--reverse', '--format=%H%x1f%cI%x1f%s%x1e');
  return output.split('\x1e').filter(Boolean).map(row => {
    const [sha, timestamp, subject] = row.split('\x1f');
    return { sha: sha.trim(), timestamp: timestamp.trim(), subject: subject.trim() };
  });
}

function changedPaths(sha: string): string[] {
  return git('diff-tree', '--no-commit-id', '--name-only', '-r', sha).split('\n').filter(Boolean);
}

function records(): ChangeRecord[] {
  return commits().filter(commit => !isAutomationChange(commit.subject)).map(commit => ({
    sha: commit.sha,
    date: commit.timestamp.slice(0, 10),
    summary: commit.subject,
    category: classifyChange({ title: commit.subject, paths: changedPaths(commit.sha) }),
    url: `${server}/${repository}/commit/${commit.sha}`,
    tag: git('tag', '--points-at', commit.sha, '--list', 'v*').split('\n').find(Boolean),
  })).reverse();
}

const changes = records();
const history = renderHistory(changes);
const readmePath = resolve(root, 'README.md');
const changelogPath = resolve(root, 'CHANGELOG.md');
const expectedReadme = replaceGeneratedBlock(readFileSync(readmePath, 'utf8'), history);
const expectedChangelog = renderChangelog(changes);

if (mode === 'check') {
  const actualChangelog = readFileSync(changelogPath, 'utf8');
  if (readFileSync(readmePath, 'utf8') !== expectedReadme || actualChangelog !== expectedChangelog) {
    throw new Error('README.md or CHANGELOG.md is out of date. Run npm run changelog:generate.');
  }
} else {
  writeFileSync(readmePath, expectedReadme);
  writeFileSync(changelogPath, expectedChangelog);
}
