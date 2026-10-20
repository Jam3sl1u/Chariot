import { readFileSync } from 'node:fs';
import { hasAllowedTitlePrefix } from './changelog.js';

const eventPath = process.env.GITHUB_EVENT_PATH;
if (!eventPath) throw new Error('GITHUB_EVENT_PATH is required.');
const event = JSON.parse(readFileSync(eventPath, 'utf8')) as { pull_request?: { title: string } };
const title = event.pull_request?.title;
if (!title) throw new Error('This check must run for a pull request.');
if (!hasAllowedTitlePrefix(title)) {
  throw new Error('PR title must begin with feat:, fix:, docs:, test:, ci:, chore:, or refactor:.');
}
