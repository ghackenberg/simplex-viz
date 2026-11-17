const DEFAULT_REPO = process.env.GITHUB_REPO ?? 'ghackenberg/simplex-viz';

interface GitHubLabel {
  readonly name: string;
}

interface GitHubUser {
  readonly login: string;
}

interface GitHubIssue {
  readonly number: number;
  readonly title: string;
  readonly state: string;
  readonly html_url: string;
  readonly created_at: string;
  readonly updated_at: string;
  readonly user?: GitHubUser;
  readonly labels?: readonly GitHubLabel[];
  readonly body?: string | null;
  readonly comments?: number;
  readonly pull_request?: unknown;
}

interface GitHubComment {
  readonly id: number;
  readonly created_at: string;
  readonly html_url: string;
  readonly user?: GitHubUser;
  readonly body?: string | null;
}

function buildHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: 'application/vnd.github+json',
    'User-Agent': 'simplex-viz-issue-cli',
  };
  const token = process.env.GITHUB_TOKEN?.trim();
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
  return headers;
}

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { headers: buildHeaders() });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`GitHub API ${res.status} ${res.statusText} for ${url}: ${text}`);
  }
  return (await res.json()) as T;
}

async function listIssues(state: 'open' | 'closed' | 'all'): Promise<void> {
  const url = `https://api.github.com/repos/${DEFAULT_REPO}/issues?state=${state}&per_page=30`;
  const raw = await fetchJson<readonly GitHubIssue[]>(url);
  const issues = raw.filter((entry) => !entry.pull_request);

  console.log(`# ${DEFAULT_REPO} — ${state.toUpperCase()} Issues (${issues.length})\n`);
  if (issues.length === 0) {
    console.log('No matching issues found.');
    return;
  }

  for (const issue of issues) {
    const labels =
      issue.labels && issue.labels.length > 0
        ? ` [${issue.labels.map((l) => l.name).join(', ')}]`
        : '';
    const author = issue.user?.login ? ` by @${issue.user.login}` : '';
    console.log(
      `- #${issue.number} (${issue.state})${labels}: ${issue.title}${author}\n  ${issue.html_url}`,
    );
  }
}

async function showIssue(issueNumber: number): Promise<void> {
  const baseUrl = `https://api.github.com/repos/${DEFAULT_REPO}/issues/${issueNumber}`;
  const [issue, comments] = await Promise.all([
    fetchJson<GitHubIssue>(baseUrl),
    fetchJson<readonly GitHubComment[]>(`${baseUrl}/comments?per_page=100`),
  ]);

  const labels =
    issue.labels && issue.labels.length > 0
      ? issue.labels.map((l) => l.name).join(', ')
      : 'none';

  console.log(`# Issue #${issue.number}: ${issue.title}`);
  console.log(`- Repository: ${DEFAULT_REPO}`);
  console.log(`- State:      ${issue.state}`);
  console.log(`- Author:     @${issue.user?.login ?? 'unknown'}`);
  console.log(`- Created:    ${issue.created_at}`);
  console.log(`- Labels:     ${labels}`);
  console.log(`- URL:        ${issue.html_url}\n`);
  console.log('## Description\n');
  console.log(issue.body?.trim() || '*(No description provided)*');

  if (comments.length > 0) {
    console.log(`\n## Comments (${comments.length})\n`);
    for (const comment of comments) {
      console.log(
        `### @${comment.user?.login ?? 'unknown'} (${comment.created_at})\n${comment.body?.trim() ?? ''}\n`,
      );
    }
  }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const first = args[0]?.trim();

  if (!first || first === 'list' || first === '--open') {
    await listIssues('open');
    return;
  }
  if (first === '--all' || first === 'all') {
    await listIssues('all');
    return;
  }
  if (first === '--closed' || first === 'closed') {
    await listIssues('closed');
    return;
  }

  const parsed = Number.parseInt(first.replace(/^#/, ''), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    console.error(
      'Usage:\n  npm run issue              # List open issues\n  npm run issue -- all       # List all issues\n  npm run issue -- <number>  # Fetch full details & comments for #<number>',
    );
    process.exit(1);
  }

  await showIssue(parsed);
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
