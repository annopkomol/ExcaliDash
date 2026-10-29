/**
 * Minimal Jira Cloud REST client. Outbound requests are restricted to
 * https://<site>.atlassian.net (SSRF guard), never follow redirects, and time out.
 */
const SITE_HOST_RE = /^[a-z0-9][a-z0-9-]{0,62}\.atlassian\.net$/;
const ISSUE_KEY_RE = /^[A-Z][A-Z0-9_]{1,30}-\d{1,9}$/;
const TIMEOUT_MS = 8000;

export class JiraRequestError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export const isValidIssueKey = (key: string) => ISSUE_KEY_RE.test(key);

/** Returns the normalized origin (https://x.atlassian.net) or null if not allowed. */
export const normalizeSiteUrl = (raw: string): string | null => {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || url.port || url.username || url.password) {
    return null;
  }
  if (!SITE_HOST_RE.test(url.hostname.toLowerCase())) return null;
  return url.origin.toLowerCase();
};

const jiraGet = async (
  siteUrl: string,
  path: string,
  email: string,
  apiToken: string,
): Promise<any> => {
  const origin = normalizeSiteUrl(siteUrl);
  if (!origin) throw new JiraRequestError(400, "Invalid Jira site URL");
  let response: Response;
  try {
    response = await fetch(`${origin}${path}`, {
      method: "GET",
      redirect: "manual",
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: {
        Accept: "application/json",
        Authorization: `Basic ${Buffer.from(`${email}:${apiToken}`).toString("base64")}`,
      },
    });
  } catch {
    throw new JiraRequestError(502, "Could not reach Jira");
  }
  if (response.status === 401 || response.status === 403) {
    throw new JiraRequestError(401, "Jira rejected the credentials");
  }
  if (response.status === 404)
    throw new JiraRequestError(404, "Issue not found");
  if (!response.ok) throw new JiraRequestError(502, "Jira request failed");
  return response.json();
};

export const verifyCredentials = async (
  siteUrl: string,
  email: string,
  apiToken: string,
) => {
  await jiraGet(siteUrl, "/rest/api/3/myself", email, apiToken);
};

const AVATAR_HOST_SUFFIXES = [
  ".atlassian.net",
  ".atlassian.com",
  ".atl-paas.net",
  ".gravatar.com",
  ".wp.com",
];
const AVATAR_TYPES = new Set(["image/png", "image/jpeg", "image/gif"]);
const AVATAR_MAX_BYTES = 150 * 1024;
const AVATAR_MAX_HOPS = 3;

const isAllowedAvatarUrl = (url: URL) =>
  url.protocol === "https:" &&
  !url.port &&
  !url.username &&
  !url.password &&
  AVATAR_HOST_SUFFIXES.some((suffix) =>
    url.hostname.toLowerCase().endsWith(suffix),
  );

/**
 * Downloads an assignee avatar as a data URL. Only allowlisted https image hosts
 * (re-checked on every redirect hop), raster image types and a small size cap are
 * accepted; anything else yields null so the card falls back to initials.
 */
export const fetchAvatarDataUrl = async (
  rawUrl: string,
): Promise<string | null> => {
  try {
    let url = new URL(rawUrl);
    for (let hop = 0; hop <= AVATAR_MAX_HOPS; hop += 1) {
      if (!isAllowedAvatarUrl(url)) return null;
      const response = await fetch(url, {
        redirect: "manual",
        signal: AbortSignal.timeout(TIMEOUT_MS),
        headers: { Accept: "image/png,image/jpeg,image/gif" },
      });
      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get("location");
        if (!location) return null;
        url = new URL(location, url);
        continue;
      }
      if (!response.ok) return null;
      const type = (response.headers.get("content-type") ?? "")
        .split(";")[0]!
        .trim()
        .toLowerCase();
      if (!AVATAR_TYPES.has(type)) return null;
      const bytes = Buffer.from(await response.arrayBuffer());
      if (bytes.length === 0 || bytes.length > AVATAR_MAX_BYTES) return null;
      return `data:${type};base64,${bytes.toString("base64")}`;
    }
  } catch {
    // fall through: no avatar
  }
  return null;
};

export type JiraIssueSummary = {
  key: string;
  summary: string;
  issueType: "task" | "bug" | "story" | "epic";
  status: string;
  statusCategory: "todo" | "inprogress" | "done";
  assignee: string | null;
  assigneeAvatar: string | null;
  url: string;
};

const mapIssueType = (name: string): JiraIssueSummary["issueType"] => {
  const n = name.toLowerCase();
  if (n.includes("bug")) return "bug";
  if (n.includes("epic")) return "epic";
  if (n.includes("story")) return "story";
  return "task";
};

export const fetchIssue = async (
  siteUrl: string,
  email: string,
  apiToken: string,
  key: string,
): Promise<JiraIssueSummary> => {
  if (!isValidIssueKey(key))
    throw new JiraRequestError(400, "Invalid issue key");
  const origin = normalizeSiteUrl(siteUrl)!;
  const data = await jiraGet(
    siteUrl,
    `/rest/api/3/issue/${encodeURIComponent(key)}?fields=summary,issuetype,status,assignee`,
    email,
    apiToken,
  );
  const fields = data?.fields ?? {};
  const category = fields.status?.statusCategory?.key;
  const avatarUrl = fields.assignee?.avatarUrls?.["48x48"];
  const assigneeAvatar =
    typeof avatarUrl === "string" ? await fetchAvatarDataUrl(avatarUrl) : null;
  return {
    key: String(data?.key ?? key),
    summary: String(fields.summary ?? "").slice(0, 500),
    issueType: mapIssueType(String(fields.issuetype?.name ?? "")),
    status: String(fields.status?.name ?? "").slice(0, 100),
    statusCategory:
      category === "done"
        ? "done"
        : category === "indeterminate"
          ? "inprogress"
          : "todo",
    assignee: fields.assignee?.displayName
      ? String(fields.assignee.displayName).slice(0, 100)
      : null,
    assigneeAvatar,
    url: `${origin}/browse/${encodeURIComponent(String(data?.key ?? key))}`,
  };
};
