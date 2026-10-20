import { readFileSync } from 'node:fs';
import { classifyChange, cleanSummary } from './changelog.js';

type PullRequest = { number: number; title: string; html_url: string; user: { login: string }; labels: { name: string }[]; head: { sha: string }; updated_at: string };
type PullRequestFile = { filename: string };
type Comment = { id: number; body: string };

const token = process.env.GITHUB_TOKEN;
const repository = process.env.GITHUB_REPOSITORY;
const eventPath = process.env.GITHUB_EVENT_PATH;
if (!token || !repository || !eventPath) throw new Error('GITHUB_TOKEN, GITHUB_REPOSITORY and GITHUB_EVENT_PATH are required.');
const event = JSON.parse(readFileSync(eventPath, 'utf8')) as { pull_request?: { number: number } };
const number = event.pull_request?.number;
if (!number) throw new Error('This workflow must run for a pull request.');

const api = `https://api.github.com/repos/${repository}`;
async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${api}${path}`, {
    ...init,
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'X-GitHub-Api-Version': '2022-11-28',
      ...init.headers,
    },
  });
  if (!response.ok) throw new Error(`${init.method ?? 'GET'} ${path} failed (${response.status}).`);
  return response.json() as Promise<T>;
}

const pr = await request<PullRequest>(`/pulls/${number}`);
const files = await request<PullRequestFile[]>(`/pulls/${number}/files?per_page=100`);
const category = classifyChange({ title: pr.title, labels: pr.labels.map(label => label.name), paths: files.map(file => file.filename) });
const marker = '<!-- chariot-changelog-preview -->';
const body = `${marker}
## Proposed changelog entry

- **Category:** ${category}
- **Summary:** ${cleanSummary(pr.title)}
- **Files changed:** ${files.length}
- **Head commit:** \`${pr.head.sha.slice(0, 7)}\`
- **Updated:** ${new Date(pr.updated_at).toISOString()}

This preview becomes permanent only after the PR is squash-merged into \`main\`.`;
const comments = await request<Comment[]>(`/issues/${number}/comments?per_page=100`);
const previous = comments.find(comment => comment.body.includes(marker));
if (previous) await request(`/issues/comments/${previous.id}`, { method: 'PATCH', body: JSON.stringify({ body }) });
else await request(`/issues/${number}/comments`, { method: 'POST', body: JSON.stringify({ body }) });
