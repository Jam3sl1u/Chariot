import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { changelogMatchesLandingCommit, classifyChange, isAutomationChange, renderChangelog, renderHistory, replaceGeneratedBlock, type ChangeRecord } from './changelog.js';

const root = resolve(import.meta.dirname, '..');
const mode = process.argv.includes('--check') ? 'check' : 'write';
const repository = process.env.GITHUB_REPOSITORY ?? 'Jam3sl1u/Chariot';
const server = (process.env.GITHUB_SERVER_URL ?? 'https://github.com').replace(/\/$/, '');

function git(...args: string[]): string {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trimEnd();
}

function refExists(ref: string): boolean {
  try {
    git('rev-parse', '--verify', '--quiet', ref);
    return true;
  } catch {
    return false;
  }
}

/**
 * GitHub Actions checks out a detached commit for pull requests, so a local
 * `main` branch is not guaranteed to exist. Prefer the PR base, then the
 * fetched remote default branch, while retaining local use outside Actions.
 */
function historyRef(): string {
  const candidates = [
    process.env.GITHUB_BASE_REF && `origin/${process.env.GITHUB_BASE_REF}`,
    'origin/main',
    'main',
    'HEAD',
  ].filter((candidate): candidate is string => Boolean(candidate));
  const ref = candidates.find(refExists);
  if (!ref) throw new Error('Unable to locate a commit history reference.');
  return ref;
}

type Commit = { sha: string; timestamp: string; subject: string };
function commits(ref: string): Commit[] {
  const output = git('log', ref, '--reverse', '--format=%H%x1f%cI%x1f%s%x1e');
  return output.split('\x1e').filter(Boolean).map(row => {
    const [sha, timestamp, subject] = row.split('\x1f');
    return { sha: sha.trim(), timestamp: timestamp.trim(), subject: subject.trim() };
  });
}

function changedPaths(sha: string): string[] {
  return git('diff-tree', '--no-commit-id', '--name-only', '-r', sha).split('\n').filter(Boolean);
}

function records(ref: string): ChangeRecord[] {
  return commits(ref).filter(commit => !isAutomationChange(commit.subject)).map(commit => ({
    sha: commit.sha,
    date: commit.timestamp.slice(0, 10),
    summary: commit.subject,
    category: classifyChange({ title: commit.subject, paths: changedPaths(commit.sha) }),
    url: `${server}/${repository}/commit/${commit.sha}`,
    tag: git('tag', '--points-at', commit.sha, '--list', 'v*').split('\n').find(Boolean),
  })).reverse();
}

function rendered(ref: string, readme: string): { readme: string; changelog: string } {
  const changes = records(ref);
  const history = renderHistory(changes);
  return { readme: replaceGeneratedBlock(readme, history), changelog: renderChangelog(changes) };
}

const readmePath = resolve(root, 'README.md');
const changelogPath = resolve(root, 'CHANGELOG.md');
const ref = historyRef();
const readme = readFileSync(readmePath, 'utf8');
const expected = rendered(ref, readme);

if (mode === 'check') {
  const actualChangelog = readFileSync(changelogPath, 'utf8');
  const matchesRef = readme === expected.readme && actualChangelog === expected.changelog;
  const parent = `${ref}^`;
  const matchesFirstParent = refExists(parent) && (() => {
    const earlier = rendered(parent, readme);
    return readme === earlier.readme && actualChangelog === earlier.changelog;
  })();
  let checkingHead = false;
  try {
    checkingHead = git('rev-parse', ref) === git('rev-parse', 'HEAD');
  } catch {
    checkingHead = false;
  }
  if (!changelogMatchesLandingCommit({
    matchesRef,
    matchesFirstParent,
    checkingHead,
    eventName: process.env.GITHUB_EVENT_NAME,
  })) {
    throw new Error('README.md or CHANGELOG.md is out of date. Run npm run changelog:generate.');
  }
} else {
  writeFileSync(readmePath, expected.readme);
  writeFileSync(changelogPath, expected.changelog);
}
