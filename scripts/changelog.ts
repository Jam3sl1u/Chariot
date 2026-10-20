export const README_CHANGELOG_START = '<!-- changelog:start -->';
export const README_CHANGELOG_END = '<!-- changelog:end -->';

export const categories = ['Features', 'Fixes', 'Documentation', 'Tests', 'CI', 'Maintenance', 'Changes'] as const;
export type ChangeCategory = typeof categories[number];

export type ChangeInput = {
  title: string;
  labels?: string[];
  paths?: string[];
};

export type ChangeRecord = {
  sha: string;
  date: string;
  summary: string;
  category: ChangeCategory;
  url: string;
  pullRequest?: number;
  author?: string;
  tag?: string;
};

const prefixCategories: Record<string, ChangeCategory> = {
  feat: 'Features',
  fix: 'Fixes',
  docs: 'Documentation',
  test: 'Tests',
  ci: 'CI',
  chore: 'Maintenance',
  refactor: 'Changes',
};

export function hasAllowedTitlePrefix(title: string): boolean {
  return /^(feat|fix|docs|test|ci|chore|refactor)(?:\([^)]*\))?!?:\s+\S/i.test(title.trim());
}

const labelCategories: Record<string, ChangeCategory> = {
  feature: 'Features',
  enhancement: 'Features',
  fix: 'Fixes',
  bug: 'Fixes',
  documentation: 'Documentation',
  docs: 'Documentation',
  test: 'Tests',
  tests: 'Tests',
  ci: 'CI',
  maintenance: 'Maintenance',
  chore: 'Maintenance',
};

/** Return a safe, one-line changelog summary from untrusted GitHub text. */
export function cleanSummary(value: string, maxLength = 160): string {
  const withoutPrefix = value.trim().replace(/^(feat|fix|docs|test|ci|chore|refactor)(?:\([^)]*\))?!?:\s*/i, '');
  const oneLine = withoutPrefix.replace(/[\r\n]+/g, ' ').replace(/[\[\]<>`]/g, '').replace(/\s+/g, ' ').trim();
  if (!oneLine) return 'Untitled change';
  return oneLine.length <= maxLength ? oneLine : `${oneLine.slice(0, maxLength - 1).trimEnd()}…`;
}

export function classifyChange({ title, labels = [], paths = [] }: ChangeInput): ChangeCategory {
  for (const label of labels) {
    const category = labelCategories[label.toLowerCase()];
    if (category) return category;
  }
  const prefix = title.trim().match(/^([a-z]+)(?:\([^)]*\))?!?:/i)?.[1]?.toLowerCase();
  if (prefix && prefixCategories[prefix]) return prefixCategories[prefix];

  const nonEmptyPaths = paths.filter(Boolean);
  if (nonEmptyPaths.length && nonEmptyPaths.every(path => /(^|\/)(docs?|documentation)\/|\.md$/i.test(path))) return 'Documentation';
  if (nonEmptyPaths.length && nonEmptyPaths.every(path => /(^|\/)tests?\/|\.test\.ts$/i.test(path))) return 'Tests';
  if (nonEmptyPaths.length && nonEmptyPaths.every(path => path.startsWith('.github/'))) return 'CI';
  if (nonEmptyPaths.length && nonEmptyPaths.every(path => /(^|\/)(package(-lock)?\.json|tsconfig\.json|\.gitignore)$/i.test(path))) return 'Maintenance';
  return 'Changes';
}

export function isAutomationChange(title: string, labels: string[] = []): boolean {
  return labels.some(label => label.toLowerCase() === 'release-automation')
    || /^chore(?:\(release\))?:\s*sync changelog/i.test(title.trim());
}

/** Determine the next vYYYY.MM.DD.N tag in the configured release timezone. */
export function nextCalendarVersion(existingTags: string[], timestamp: Date, timezone = 'America/Los_Angeles'): string {
  const date = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(timestamp).replaceAll('-', '.');
  const expression = new RegExp(`^v${date.replaceAll('.', '\\.') }\\.(\\d+)$`);
  const sequence = existingTags.reduce((maximum, tag) => {
    const match = tag.match(expression);
    return match ? Math.max(maximum, Number(match[1])) : maximum;
  }, 0);
  return `v${date}.${sequence + 1}`;
}

function formatEntry(change: ChangeRecord): string {
  const source = change.pullRequest ? `PR #${change.pullRequest}` : change.sha.slice(0, 7);
  const tag = change.tag ? `**${change.tag}** — ` : '';
  const author = change.author ? ` — ${change.author}` : '';
  return `- **${change.category}** — ${tag}${change.date} — [${cleanSummary(change.summary)}](${change.url}) (${source})${author}`;
}

export function renderHistory(changes: ChangeRecord[]): string {
  return ['## Change history', '', ...changes.map(formatEntry)].join('\n').trimEnd();
}

export function replaceGeneratedBlock(readme: string, history: string): string {
  const block = `${README_CHANGELOG_START}\n${history}\n${README_CHANGELOG_END}`;
  const start = readme.indexOf(README_CHANGELOG_START);
  const end = readme.indexOf(README_CHANGELOG_END);
  if (start === -1 && end === -1) return `${readme.trimEnd()}\n\n${block}\n`;
  if (start < 0 || end < start) throw new Error('README changelog markers are malformed.');
  return `${readme.slice(0, start)}${block}${readme.slice(end + README_CHANGELOG_END.length)}`;
}

export function renderChangelog(changes: ChangeRecord[]): string {
  return ['# Changelog', '', 'Automatically generated from commits merged into `main`.', '', renderHistory(changes), ''].join('\n');
}
