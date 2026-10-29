import React, { useEffect, useState } from "react";
import { SquareKanban } from "lucide-react";
import * as api from "../../api";
import { PasswordInput } from "../../components/PasswordInput";
import { getApiErrorMessage } from "../../utils/getApiErrorMessage";
import {
  SettingsCard,
  SettingsSectionHeader,
  settingsButtonClass,
  settingsPrimaryButtonClass,
} from "./SettingsRow";

type Props = {
  disabled: boolean;
  onSuccess: (message: string) => void;
};

/**
 * Per-user Jira Cloud credentials. The API token is sent once to the backend,
 * which verifies and stores it encrypted; it is never returned or kept in the
 * browser, so the form is cleared after saving.
 */
export const JiraCard: React.FC<Props> = ({ disabled, onSuccess }) => {
  const [status, setStatus] = useState<api.JiraConnectionStatus | null>(null);
  const [siteUrl, setSiteUrl] = useState("");
  const [email, setEmail] = useState("");
  const [apiToken, setApiToken] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (disabled) return;
    let cancelled = false;
    api
      .getJiraConnection()
      .then((next) => {
        if (!cancelled) setStatus(next);
      })
      .catch(() => {
        if (!cancelled) setStatus({ connected: false });
      });
    return () => {
      cancelled = true;
    };
  }, [disabled]);

  if (disabled) return null;

  const handleConnect = async (event: React.FormEvent) => {
    event.preventDefault();
    setLoading(true);
    setError("");
    try {
      const next = await api.connectJira({ siteUrl, email, apiToken });
      setStatus(next);
      setApiToken("");
      onSuccess("Jira connected");
    } catch (err) {
      setError(getApiErrorMessage(err, "Failed to connect Jira"));
    } finally {
      setLoading(false);
    }
  };

  const handleDisconnect = async () => {
    setLoading(true);
    setError("");
    try {
      await api.disconnectJira();
      setStatus({ connected: false });
      onSuccess("Jira disconnected");
    } catch (err) {
      setError(getApiErrorMessage(err, "Failed to disconnect Jira"));
    } finally {
      setLoading(false);
    }
  };

  return (
    <section>
      <SettingsSectionHeader
        icon={<SquareKanban size={20} />}
        tileClassName="border-black bg-blue-400 text-black dark:border-neutral-700 dark:bg-blue-400 dark:text-black"
        title="Jira"
        subtitle="Fill Jira cards on the canvas from your issues"
      />
      {error && (
        <div className="mb-3 p-3.5 bg-red-50 dark:bg-red-950 border-2 border-red-200 dark:border-red-800 rounded-xl">
          <p className="text-red-800 dark:text-red-200 font-medium">{error}</p>
        </div>
      )}
      <SettingsCard>
        {status?.connected ? (
          <div className="flex flex-wrap items-center gap-3 px-4 py-3.5 sm:px-5">
            <div className="min-w-0 flex-1 basis-40">
              <p className="text-sm font-bold text-slate-900 dark:text-white break-all">
                {status.siteUrl}
              </p>
              <p className="text-xs text-slate-500 dark:text-neutral-400 break-all">
                {status.email} · API token stored encrypted
              </p>
            </div>
            <button
              type="button"
              className={settingsButtonClass}
              disabled={loading}
              onClick={() => void handleDisconnect()}
            >
              Disconnect
            </button>
          </div>
        ) : (
          <form
            onSubmit={handleConnect}
            className="space-y-3 px-4 py-3.5 sm:px-5"
            autoComplete="off"
          >
            <input
              className="ui-input w-full"
              placeholder="https://your-team.atlassian.net"
              value={siteUrl}
              onChange={(e) => setSiteUrl(e.target.value)}
              required
            />
            <input
              className="ui-input w-full"
              type="email"
              placeholder="Atlassian account email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
            <PasswordInput
              value={apiToken}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                setApiToken(e.target.value)
              }
              className="ui-input w-full"
              placeholder="API token"
              autoComplete="off"
              required
            />
            <p className="text-xs text-slate-500 dark:text-neutral-400">
              Create a token at id.atlassian.com → Security → API tokens. It is
              verified against Jira, then stored encrypted on the server and
              never shown again. Only *.atlassian.net sites are supported.
            </p>
            <button
              type="submit"
              className={settingsPrimaryButtonClass}
              disabled={loading || !siteUrl || !email || !apiToken}
            >
              {loading ? "Connecting..." : "Connect"}
            </button>
          </form>
        )}
      </SettingsCard>
    </section>
  );
};
