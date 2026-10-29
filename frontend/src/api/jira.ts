import { api } from "./client";
import type { JiraIssueType, JiraStatusCategory } from "../utils/jiraCard";

export type JiraConnectionStatus =
  | { connected: false }
  | { connected: true; siteUrl: string; email: string };

export type JiraIssue = {
  key: string;
  summary: string;
  issueType: JiraIssueType;
  status: string;
  statusCategory: JiraStatusCategory;
  assignee: string | null;
  url: string;
};

export const getJiraConnection = async (): Promise<JiraConnectionStatus> =>
  (await api.get<JiraConnectionStatus>("/integrations/jira")).data;

export const connectJira = async (input: {
  siteUrl: string;
  email: string;
  apiToken: string;
}): Promise<JiraConnectionStatus> =>
  (await api.put<JiraConnectionStatus>("/integrations/jira", input)).data;

export const disconnectJira = async (): Promise<void> => {
  await api.delete("/integrations/jira");
};

export const getJiraIssue = async (key: string): Promise<JiraIssue> =>
  (
    await api.get<JiraIssue>(
      `/integrations/jira/issues/${encodeURIComponent(key)}`,
    )
  ).data;
