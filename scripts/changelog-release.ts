import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { classifyChange, cleanSummary, isAutomationChange, nextCalendarVersion } from './changelog.js';

type PullRequest = { number: number; title: string; html_url: string; merged_at: string | null; user: { login: string }; labels: { name: string }[] };
type Commit = { sha: string; commit: { message: string; committer: { date: string } }; html_url: string; author: { login: string } | null };
type PullRequestFile = { filename: string };

const root = resolve(import.meta.dirname, '..');
const token = process.env.GITHUB_TOKEN;
const repository = process.env.GITHUB_REPOSITORY;
const sha = process.env.GITHUB_SHA;
if (!token || !repository || !sha) throw new Error('GITHUB_TOKEN, GITHUB_REPOSITORY and GITHUB_SHA are required.');
const workflowSha = sha;
const api = `https://api.github.com/repos/${repository}`;

function git(...args: string[]): string {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trimEnd();
}
async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${api}${path}`, {
    ...init,
    headers: {
      Accept: 'application/vnd.github+json', Authorization: `Bearer ${token}`, 'X-GitHub-Api-Version': '2022-11-28', ...init.headers,
    },
  });
  if (response.status === 404) throw new Error(`${init.method ?? 'GET'} ${path} returned 404.`);
  if (!response.ok) throw new Error(`${init.method ?? 'GET'} ${path} failed (${response.status}): ${await response.text()}`);
  return response.json() as Promise<T>;
}
async function optional<T>(path: string): Promise<T | undefined> {
  const response = await fetch(`${api}${path}`, {
    headers: { Accept: 'application/vnd.github+json', Authorization: `Bearer ${token}`, 'X-GitHub-Api-Version': '2022-11-28' },
  });
  if (response.status === 404) return undefined;
  if (!response.ok) throw new Error(`GET ${path} failed (${response.status}): ${await response.text()}`);
  return response.json() as Promise<T>;
}
function commitsToRelease(): string[] {
  const tags = git('tag', '--list', 'v*').split('\n').filter(Boolean);
  const latest = tags.sort().at(-1);
  if (!latest) return [workflowSha];
  return git('log', `${latest}..${workflowSha}`, '--reverse', '--format=%H').split('\n').filter(Boolean);
}

async function releaseCommit(commitSha: string): Promise<void> {
  const commit = await request<Commit>(`/commits/${commitSha}`);
  const pulls = await request<PullRequest[]>(`/commits/${commitSha}/pulls`);
  const pr = pulls.find(candidate => candidate.merged_at) ?? pulls[0];
  const title = pr?.title ?? commit.commit.message.split('\n', 1)[0];
  if (isAutomationChange(title, pr?.labels.map(label => label.name))) return;

  const existingTag = git('tag', '--points-at', commitSha, '--list', 'v*').split('\n').find(Boolean);
  const paths = pr ? await request<PullRequestFile[]>(`/pulls/${pr.number}/files?per_page=100`) : [];
  const timestamp = new Date(pr?.merged_at ?? commit.commit.committer.date);
  const tag = existingTag ?? nextCalendarVersion(git('tag', '--list', 'v*').split('\n').filter(Boolean), timestamp);
  const category = classifyChange({ title, labels: pr?.labels.map(label => label.name), paths: paths.map(file => file.filename) });
  const summary = cleanSummary(title);
  const body = [`## ${category}`, '', `- ${summary}`, `- Commit: ${commit.html_url}`, pr ? `- Pull request: ${pr.html_url}` : '', `- Author: ${pr?.user.login ?? commit.author?.login ?? 'unknown'}`].filter(Boolean).join('\n');

  if (!existingTag) {
    git('tag', '-a', tag, commitSha, '-m', `${tag}: ${summary}`);
    git('push', 'origin', tag);
  }
  if (await optional<{ id: number }>(`/releases/tags/${encodeURIComponent(tag)}`)) return;
  await request('/releases', { method: 'POST', body: JSON.stringify({ tag_name: tag, target_commitish: commitSha, name: tag, body }) });
}

for (const commitSha of commitsToRelease()) await releaseCommit(commitSha);

// Keep this workflow usable in a PR/dry-run checkout: generation itself never calls GitHub.
if (existsSync(resolve(root, 'README.md'))) {
  execFileSync('npx', ['tsx', 'scripts/changelog-generate.ts', '--write'], { cwd: root, stdio: 'inherit' });
}
