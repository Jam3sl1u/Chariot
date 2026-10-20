import assert from 'node:assert/strict';
import test from 'node:test';
import {
  classifyChange,
  cleanSummary,
  hasAllowedTitlePrefix,
  isAutomationChange,
  nextCalendarVersion,
  README_CHANGELOG_END,
  README_CHANGELOG_START,
  renderChangelog,
  renderHistory,
  replaceGeneratedBlock,
  type ChangeRecord,
} from '../scripts/changelog.js';

const change = (overrides: Partial<ChangeRecord> = {}): ChangeRecord => ({
  sha: 'abcdef0123456789',
  date: '2026-10-20',
  summary: 'feat: Add automatic release notes',
  category: 'Features',
  url: 'https://github.com/Jam3sl1u/Chariot/commit/abcdef0123456789',
  ...overrides,
});

test('changelog classification prefers labels, then title, then changed paths', () => {
  assert.equal(classifyChange({ title: 'fix: Correct a race', labels: ['documentation'], paths: ['src/a.ts'] }), 'Documentation');
  assert.equal(classifyChange({ title: 'fix(api): Correct a race' }), 'Fixes');
  assert.equal(classifyChange({ title: 'Improve guide', paths: ['docs/guide.md'] }), 'Documentation');
  assert.equal(classifyChange({ title: 'Improve checks', paths: ['.github/workflows/ci.yml'] }), 'CI');
  assert.equal(classifyChange({ title: 'Improve behaviour', paths: ['src/service.ts'] }), 'Changes');
});

test('summaries are one line, prefix-free, escaped, and bounded', () => {
  assert.equal(cleanSummary('feat(api): Add [safe]\nrelease notes'), 'Add safe release notes');
  assert.equal(cleanSummary('fix: x'.repeat(200)).endsWith('…'), true);
  assert.equal(cleanSummary('   '), 'Untitled change');
});

test('automation changes are excluded from ordinary release history', () => {
  assert.equal(isAutomationChange('chore(release): sync changelog'), true);
  assert.equal(isAutomationChange('Any title', ['release-automation']), true);
  assert.equal(isAutomationChange('feat: send notifications'), false);
});

test('pull request titles require a conventional changelog prefix', () => {
  assert.equal(hasAllowedTitlePrefix('feat: send assignment notifications'), true);
  assert.equal(hasAllowedTitlePrefix('fix(sheets): retry rate limits'), true);
  assert.equal(hasAllowedTitlePrefix('Improve the bot'), false);
});

test('calendar tags increment in Los Angeles time and ignore other days', () => {
  const instant = new Date('2026-10-21T06:30:00.000Z'); // 2026-10-20 in Los Angeles
  assert.equal(nextCalendarVersion(['v2026.10.20.1', 'v2026.10.20.3', 'v2026.10.21.1'], instant), 'v2026.10.20.4');
});

test('generated README section leaves hand-authored content untouched and is idempotent', () => {
  const original = '# Chariot\n\nHand-written status table.\n';
  const history = renderHistory([change()]);
  const once = replaceGeneratedBlock(original, history);
  const twice = replaceGeneratedBlock(once, history);
  assert.equal(once, twice);
  assert.match(once, /Hand-written status table/);
  assert.match(once, new RegExp(README_CHANGELOG_START));
  assert.match(once, new RegExp(README_CHANGELOG_END));
});

test('full changelog includes links, categories, and optional release metadata', () => {
  const output = renderChangelog([change({ tag: 'v2026.10.20.1', pullRequest: 12, author: 'james' })]);
  assert.match(output, /\*\*Features\*\*/);
  assert.match(output, /\*\*v2026\.10\.20\.1\*\*/);
  assert.match(output, /PR #12/);
  assert.match(output, /james/);
});
