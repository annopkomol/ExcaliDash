import React from "react";
import { toast } from "sonner";
import * as api from "../api";
import { getApiErrorMessage } from "../utils/getApiErrorMessage";
import { CaptureUpdateAction } from "@excalidraw/excalidraw";
import {
  JIRA_TYPES,
  buildJiraCardElements,
  createJiraGroupId,
  parseJiraReference,
  type JiraIssueType,
  type JiraStatusCategory,
} from "../utils/jiraCard";

const STATUS_PRESETS: { label: string; category: JiraStatusCategory }[] = [
  { label: "To Do", category: "todo" },
  { label: "In Progress", category: "inprogress" },
  { label: "Done", category: "done" },
];

const fieldClass =
  "w-full rounded-lg border-2 border-black dark:border-neutral-600 bg-white dark:bg-neutral-800 px-3 py-1.5 text-sm text-slate-900 dark:text-white";

interface JiraCardDialogProps {
  excalidrawAPI: any;
  onClose: () => void;
}

/**
 * Inserts a Jira-style card built from native Excalidraw elements. Fields are
 * entered manually (no Jira credentials involved); the pasted URL becomes the
 * element link so clicking the card opens the issue.
 */
export const JiraCardDialog: React.FC<JiraCardDialogProps> = ({
  excalidrawAPI,
  onClose,
}) => {
  const [reference, setReference] = React.useState("");
  const [title, setTitle] = React.useState("");
  const [issueType, setIssueType] = React.useState<JiraIssueType>("task");
  const [statusIndex, setStatusIndex] = React.useState(0);
  const [assignee, setAssignee] = React.useState("");

  const [connected, setConnected] = React.useState(false);
  const [fetching, setFetching] = React.useState(false);
  const [fetchedStatus, setFetchedStatus] = React.useState<{
    label: string;
    category: JiraStatusCategory;
  } | null>(null);
  const [fetchedUrl, setFetchedUrl] = React.useState<string | undefined>();

  React.useEffect(() => {
    api
      .getJiraConnection()
      .then((next) => setConnected(next.connected))
      .catch(() => setConnected(false));
  }, []);

  const parsed = parseJiraReference(reference);
  const { key } = parsed;
  const url = parsed.url ?? fetchedUrl;

  const handleFetch = async () => {
    if (!key) return;
    setFetching(true);
    try {
      const issue = await api.getJiraIssue(key);
      setTitle(issue.summary);
      setIssueType(issue.issueType);
      setAssignee(issue.assignee ?? "");
      setFetchedStatus({ label: issue.status, category: issue.statusCategory });
      setStatusIndex(STATUS_PRESETS.length);
      setFetchedUrl(issue.url);
    } catch (err) {
      toast.error(getApiErrorMessage(err, "Could not fetch issue from Jira"));
    } finally {
      setFetching(false);
    }
  };

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!excalidrawAPI || !key) return;
    const appState = excalidrawAPI.getAppState();
    const zoom = appState.zoom?.value || 1;
    const origin = {
      x: -appState.scrollX + appState.width / 2 / zoom - 160,
      y: -appState.scrollY + appState.height / 2 / zoom - 60,
    };
    const preset =
      statusIndex === STATUS_PRESETS.length && fetchedStatus
        ? { label: fetchedStatus.label, category: fetchedStatus.category }
        : STATUS_PRESETS[statusIndex];
    const groupId = createJiraGroupId(key);
    const elements = buildJiraCardElements(
      {
        key,
        title: title.trim() || key,
        url,
        issueType,
        status: preset.label,
        statusCategory: preset.category,
        assignee,
      },
      origin,
      groupId,
    );
    excalidrawAPI.updateScene({
      elements: [...excalidrawAPI.getSceneElements(), ...elements],
      appState: {
        selectedElementIds: Object.fromEntries(
          elements.map((el: any) => [el.id, true]),
        ),
        selectedGroupIds: { [groupId]: true },
      },
      captureUpdate: CaptureUpdateAction.IMMEDIATELY,
    });
    toast.success(`Added ${key}`);
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 px-4"
      onMouseDown={onClose}
    >
      <form
        onSubmit={handleSubmit}
        onMouseDown={(e) => e.stopPropagation()}
        className="w-full max-w-sm space-y-3 rounded-2xl border-2 border-black dark:border-neutral-600 bg-white dark:bg-neutral-900 p-5 text-slate-900 dark:text-white shadow-lg"
      >
        <h2 className="text-lg font-bold">Add Jira card</h2>
        <input
          autoFocus
          className={fieldClass}
          placeholder="Issue key or URL (e.g. KERN-123)"
          value={reference}
          onChange={(e) => setReference(e.target.value)}
        />
        {connected ? (
          <button
            type="button"
            className="ui-button-secondary w-full px-4 disabled:opacity-50"
            disabled={!key || fetching}
            onClick={() => void handleFetch()}
          >
            {fetching ? "Fetching..." : "Fetch from Jira"}
          </button>
        ) : null}
        <input
          className={fieldClass}
          placeholder="Summary"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
        <div className="flex gap-2">
          <select
            className={fieldClass}
            value={issueType}
            onChange={(e) => setIssueType(e.target.value as JiraIssueType)}
          >
            {Object.entries(JIRA_TYPES).map(([value, t]) => (
              <option key={value} value={value}>
                {t.label}
              </option>
            ))}
          </select>
          <select
            className={fieldClass}
            value={statusIndex}
            onChange={(e) => setStatusIndex(Number(e.target.value))}
          >
            {STATUS_PRESETS.map((s, i) => (
              <option key={s.label} value={i}>
                {s.label}
              </option>
            ))}
            {fetchedStatus ? (
              <option value={STATUS_PRESETS.length}>
                {fetchedStatus.label}
              </option>
            ) : null}
          </select>
        </div>
        <input
          className={fieldClass}
          placeholder="Assignee (optional)"
          value={assignee}
          onChange={(e) => setAssignee(e.target.value)}
        />
        <div className="flex justify-end gap-2 pt-1">
          <button
            type="button"
            className="ui-button-secondary px-4"
            onClick={onClose}
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={!key}
            className="ui-button-secondary px-4 disabled:opacity-50"
          >
            Insert
          </button>
        </div>
      </form>
    </div>
  );
};
