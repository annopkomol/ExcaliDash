import React from "react";
import type { DrawingSnapshotFull } from "../../api";
import { HistoryPreviewCanvas } from "./HistoryPreviewCanvas";
import { Excalidraw, MainMenu } from "@excalidraw/excalidraw";
import {
  ArrowLeft,
  ChevronDown,
  ChevronUp,
  CloudOff,
  Download,
  History,
  Loader2,
  RefreshCw,
  Share2,
} from "lucide-react";
import clsx from "clsx";
import { LanguageSelector } from "../../components/LanguageSelector";
import { GridStepSelector } from "../../components/GridStepSelector";
import { toast, Toaster } from "sonner";
import {
  CaptureUpdateAction,
  viewportCoordsToSceneCoords,
} from "@excalidraw/excalidraw";
import { getJiraConnection, getJiraIssue } from "../../api";
import {
  parseJiraGroupId,
  parseJiraIssueUrl,
  refreshJiraCards,
} from "../../utils/jiraCard";
import { insertJiraCard, prepareAvatar } from "../../utils/jiraCardInsert";
import { JiraCardDialog } from "../../components/JiraCardDialog";
import { StickyNoteMenu } from "../../components/StickyNoteMenu";
import { StickerPicker } from "../../components/StickerPicker";
import { buildSticker, type Sticker } from "../../utils/stickers";
import {
  DEFAULT_STICKY_COLOR,
  STICKY_TEXT_STATE,
  buildStickyNote,
} from "../../utils/stickyNote";
import { ShareModal } from "../../components/ShareModal";
import { UserAvatar as ProfileAvatar } from "../../components/UserAvatar";
import type { UserIdentity } from "../../utils/identity";
import { UIOptions, validateEmbeddableUrl } from "./shared";
import { ArrowAnchorOverlay } from "./ArrowAnchorOverlay";
import { snapArrowToAnchors } from "./arrowSnap";
import { useMentionAutocomplete } from "./useMentionAutocomplete";

interface Peer extends UserIdentity {
  isActive: boolean;
}

type EditorViewProps = {
  id?: string;
  accessLevel: "none" | "view" | "edit" | "owner";
  autoHideEnabled: boolean;
  autosaveFailing: boolean;
  canEdit: boolean;
  drawingName: string;
  editorContainerRef: React.RefObject<HTMLDivElement>;
  initialData: any;
  isHeaderVisible: boolean;
  isHistoryOpen: boolean;
  historyPreview: DrawingSnapshotFull | null;
  historyButtonRef: React.RefObject<HTMLButtonElement>;
  shareButtonRef: React.RefObject<HTMLButtonElement>;
  isRenaming: boolean;
  isSavingOnLeave: boolean;
  isSceneLoading: boolean;
  langCode: string;
  loadError: string | null;
  me: UserIdentity;
  newName: string;
  peers: Peer[];
  theme: string;
  onBackClick: () => void;
  onCanvasChange: (
    elements: readonly any[],
    appState: any,
    files?: Record<string, any>,
  ) => void;
  onCanvasDropCapture: (event: React.DragEvent<HTMLDivElement>) => void;
  onExportClick: () => void;
  onLibraryChange: (items: readonly any[]) => void;
  onNavigateHome: () => void;
  onNewNameChange: (value: string) => void;
  onPointerUpdate: (payload: any) => void;
  onRenameBlur: () => void;
  onRenameStart: () => void;
  onRenameSubmit: (event: React.FormEvent) => void;
  onSetExcalidrawAPI: (api: any) => void;
  onSetLangCode: (langCode: string) => void;
  gridStep: number;
  onSetGridStep: (gridStep: number) => void;
  onShareOpen: () => void;
  isShareOpen: boolean;
  onCloseShare: () => void;
  onHistoryOpen: () => void;
  onToggleAutoHide: () => void;
  onToggleTheme: () => void;
};

const CollaboratorAvatar = ({
  user,
  label,
  inactive = false,
}: {
  user: UserIdentity;
  label: string;
  inactive?: boolean;
}) => (
  <div className="relative group" data-testid="collaborator-avatar">
    <ProfileAvatar
      name={user.name}
      size="toolbar"
      className={clsx(
        "transition-all duration-300",
        inactive && "opacity-30 grayscale",
      )}
    />
    <div className="pointer-events-none absolute right-0 top-full z-50 mt-2 whitespace-nowrap rounded-lg bg-slate-900 px-2 py-1 text-xs text-white opacity-0 transition-opacity group-hover:opacity-100">
      {label}
    </div>
  </div>
);

export const EditorView: React.FC<EditorViewProps> = ({
  id,
  accessLevel,
  autoHideEnabled,
  autosaveFailing,
  canEdit,
  drawingName,
  editorContainerRef,
  initialData,
  isHeaderVisible,
  isHistoryOpen,
  historyPreview,
  historyButtonRef,
  shareButtonRef,
  isRenaming,
  isSavingOnLeave,
  isSceneLoading,
  langCode,
  loadError,
  me,
  newName,
  peers,
  theme,
  onBackClick,
  onCanvasChange,
  onCanvasDropCapture,
  onExportClick,
  onLibraryChange,
  onNavigateHome,
  onNewNameChange,
  onPointerUpdate,
  onRenameBlur,
  onRenameStart,
  onRenameSubmit,
  onSetExcalidrawAPI,
  onSetLangCode,
  gridStep,
  onSetGridStep,
  onShareOpen,
  isShareOpen,
  onCloseShare,
  onHistoryOpen,
  onToggleAutoHide,
  onToggleTheme,
}) => {
  const [excalidrawApi, setExcalidrawApi] = React.useState<any>(null);
  const [isJiraOpen, setIsJiraOpen] = React.useState(false);
  const [stickyColor, setStickyColor] =
    React.useState<string>(DEFAULT_STICKY_COLOR);

  const addStickyNote = React.useCallback(
    (color: string) => {
      const api = excalidrawApi as any;
      if (!api || !canEdit || isHistoryOpen) return;
      setStickyColor(color);
      const appState = api.getAppState();
      const zoom = appState.zoom?.value || 1;
      const center = {
        x: -appState.scrollX + appState.width / 2 / zoom,
        y: -appState.scrollY + appState.height / 2 / zoom,
      };
      const [note] = buildStickyNote(center, color);
      api.updateScene({
        elements: [...api.getSceneElements(), note],
        appState: {
          ...STICKY_TEXT_STATE,
          selectedElementIds: { [note.id]: true },
        },
        captureUpdate: CaptureUpdateAction.IMMEDIATELY,
      });
      // Enter on a selected container starts typing straight into the note.
      window.setTimeout(() => {
        document
          .querySelector(".excalidraw-container, .excalidraw")
          ?.dispatchEvent(
            new KeyboardEvent("keydown", {
              key: "Enter",
              code: "Enter",
              bubbles: true,
            }),
          );
      }, 50);
    },
    [excalidrawApi, canEdit, isHistoryOpen],
  );

  const addSticker = React.useCallback(
    async (sticker: Sticker) => {
      const api = excalidrawApi as any;
      if (!api || !canEdit || isHistoryOpen) return;
      const appState = api.getAppState();
      const zoom = appState.zoom?.value || 1;
      const center = {
        x: -appState.scrollX + appState.width / 2 / zoom,
        y: -appState.scrollY + appState.height / 2 / zoom,
      };
      const { element, file } = await buildSticker(sticker, center);
      api.addFiles([file]);
      api.updateScene({
        elements: [...api.getSceneElements(), element],
        appState: { selectedElementIds: { [element.id]: true } },
        captureUpdate: CaptureUpdateAction.IMMEDIATELY,
      });
    },
    [excalidrawApi, canEdit, isHistoryOpen],
  );

  React.useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (
        !event.shiftKey ||
        event.ctrlKey ||
        event.metaKey ||
        event.altKey ||
        event.key.toLowerCase() !== "n"
      )
        return;
      const target = event.target as HTMLElement | null;
      if (target?.closest("input, textarea, select, [contenteditable='true']"))
        return;
      event.preventDefault();
      addStickyNote(stickyColor);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [addStickyNote, stickyColor]);
  const peerNames = React.useMemo(
    () => [me.name, ...peers.map((p) => p.name)],
    [me.name, peers],
  );
  const mentionMenu = useMentionAutocomplete({
    containerRef: editorContainerRef,
    drawingId: id,
    enabled: canEdit && !isHistoryOpen,
    extraNames: peerNames,
  });
  const [jiraRefreshing, setJiraRefreshing] = React.useState(false);
  const pointerRef = React.useRef<{ x: number; y: number } | null>(null);
  const jiraPasteHintShown = React.useRef(false);

  // Pasting a single Jira issue link drops a card at the pointer instead of plain text.
  const handlePaste = async (data: { text?: string }): Promise<boolean> => {
    const parsed = parseJiraIssueUrl(data?.text ?? "");
    if (!parsed || !canEdit || !excalidrawApi) return true;
    try {
      const connection = await getJiraConnection();
      if (!connection.connected) {
        if (!jiraPasteHintShown.current) {
          jiraPasteHintShown.current = true;
          toast.info("Connect Jira in Settings to paste issue links as cards");
        }
        return true;
      }
      const issue = await getJiraIssue(parsed.key);
      const appState = excalidrawApi.getAppState();
      const zoom = appState.zoom?.value || 1;
      const origin = pointerRef.current
        ? viewportCoordsToSceneCoords(
            { clientX: pointerRef.current.x, clientY: pointerRef.current.y },
            appState,
          )
        : {
            x: -appState.scrollX + appState.width / 2 / zoom - 160,
            y: -appState.scrollY + appState.height / 2 / zoom - 60,
          };
      await insertJiraCard(
        excalidrawApi,
        {
          key: issue.key,
          title: issue.summary || issue.key,
          url: issue.url,
          issueType: issue.issueType,
          status: issue.status,
          statusCategory: issue.statusCategory,
          assignee: issue.assignee ?? undefined,
        },
        origin,
        issue.assigneeAvatar,
      );
      return false;
    } catch {
      toast.error("Could not load the Jira issue; pasted the link instead");
      return true;
    }
  };
  const [jiraBadge, setJiraBadge] = React.useState<{
    groupId: string;
    left: number;
    top: number;
  } | null>(null);

  const refreshGroups = async (cardGroups: Set<string>) => {
    if (!excalidrawApi || jiraRefreshing) return;
    setJiraRefreshing(true);
    try {
      await runJiraRefresh(cardGroups);
    } finally {
      setJiraRefreshing(false);
    }
  };

  const handleRefreshJira = async () => {
    if (!excalidrawApi) return;
    const all: readonly any[] = excalidrawApi.getSceneElements();
    const selected = Object.keys(
      excalidrawApi.getAppState().selectedElementIds ?? {},
    );
    const selectedGroups = new Set<string>();
    for (const el of all) {
      if (selected.includes(el.id)) {
        for (const gid of el.groupIds ?? []) selectedGroups.add(gid);
      }
    }
    const cardGroups = new Set<string>();
    for (const el of all) {
      for (const gid of el.groupIds ?? []) {
        if (
          parseJiraGroupId(gid) &&
          (!selectedGroups.size || selectedGroups.has(gid))
        ) {
          cardGroups.add(gid);
        }
      }
    }
    if (cardGroups.size === 0) {
      toast.info("No Jira cards to refresh");
      return;
    }
    await refreshGroups(cardGroups);
  };

  const runJiraRefresh = async (cardGroups: Set<string>) => {
    try {
      const connection = await getJiraConnection();
      if (!connection.connected) {
        toast.error("Connect Jira in Settings first");
        return;
      }
    } catch {
      toast.error("Could not reach Jira settings");
      return;
    }
    const result = await refreshJiraCards(
      excalidrawApi.getSceneElementsIncludingDeleted(),
      [...cardGroups],
      getJiraIssue,
      prepareAvatar,
    );
    if (result.files.length > 0) excalidrawApi.addFiles(result.files);
    if (result.updated > 0) {
      excalidrawApi.updateScene({
        elements: result.elements,
        captureUpdate: CaptureUpdateAction.IMMEDIATELY,
      });
    }
    if (result.failed > 0) {
      toast.error(`Refreshed ${result.updated}, failed ${result.failed}`);
    } else {
      toast.success(
        `Refreshed ${result.updated} Jira card${result.updated === 1 ? "" : "s"}`,
      );
    }
  };
  // Ids of shapes an arrow end is about to bind to; only re-render when they change.
  const [anchorIds, setAnchorIds] = React.useState("");

  const handleChange = (
    elements: readonly any[],
    appState: any,
    files?: Record<string, any>,
  ) => {
    const ids = (appState?.suggestedBindings ?? [])
      .map((el: any) => el?.id)
      .join(",");
    setAnchorIds((prev) => (prev === ids ? prev : ids));
    const selectedGroupId = Object.keys(appState?.selectedGroupIds ?? {}).find(
      (gid) => parseJiraGroupId(gid) && appState.selectedGroupIds[gid],
    );
    let badge: typeof jiraBadge = null;
    if (
      selectedGroupId &&
      !appState.selectedElementsAreBeingDragged &&
      !appState.editingGroupId
    ) {
      let right = -Infinity;
      let top = Infinity;
      for (const el of elements) {
        if (!el.isDeleted && el.groupIds?.includes(selectedGroupId)) {
          right = Math.max(right, el.x + el.width);
          top = Math.min(top, el.y);
        }
      }
      if (Number.isFinite(right)) {
        const zoom = appState.zoom?.value ?? 1;
        badge = {
          groupId: selectedGroupId,
          left: Math.round((right + appState.scrollX) * zoom),
          top: Math.round((top + appState.scrollY) * zoom),
        };
      }
    }
    setJiraBadge((prev) =>
      prev?.groupId === badge?.groupId &&
      prev?.left === badge?.left &&
      prev?.top === badge?.top
        ? prev
        : badge,
    );
    onCanvasChange(elements, appState, files);
  };

  // Miro-style: after an arrow end binds to a shape, snap it to the nearest anchor.
  const snapSelectedArrows = () => {
    const api = excalidrawApi;
    if (!api || !canEdit) return;
    const appState = api.getAppState();
    const elements = api.getSceneElements();
    const byId = new Map<string, any>(elements.map((el: any) => [el.id, el]));
    const selected = appState.selectedElementIds ?? {};
    let changed = false;
    const next = elements.map((el: any) => {
      if (!selected[el.id]) return el;
      const snapped = snapArrowToAnchors(el, byId, appState.zoom?.value ?? 1);
      if (!snapped) return el;
      changed = true;
      return snapped;
    });
    if (changed) api.updateScene({ elements: next });
  };

  // Let Excalidraw commit the binding for this pointer-up before reading it.
  const handlePointerUp = () => {
    window.setTimeout(snapSelectedArrows, 0);
  };

  return (
    <div
      className="h-screen flex flex-col bg-white dark:bg-neutral-950 overflow-hidden"
      onKeyDownCapture={(event) => {
        if (event.altKey && event.shiftKey && event.code === "KeyD") {
          event.preventDefault();
          event.stopPropagation();
          onToggleTheme();
        }
      }}
    >
      <header
        className={clsx(
          "h-16 bg-white dark:bg-neutral-900 border-b border-gray-200 dark:border-neutral-800 flex items-center px-4 justify-between z-10 fixed top-0 left-0 right-0 transition-all duration-300",
          isHeaderVisible || isShareOpen
            ? "translate-y-0"
            : "-translate-y-full",
        )}
      >
        <div className="flex items-center gap-4">
          <button
            onClick={onBackClick}
            disabled={isSavingOnLeave}
            className={`flex items-center gap-2 p-2 hover:bg-gray-100 dark:hover:bg-neutral-800 rounded-full text-gray-600 dark:text-gray-300 disabled:opacity-50 disabled:cursor-wait transition-all duration-200 ${isSavingOnLeave ? "pr-4" : ""}`}
          >
            {isSavingOnLeave ? (
              <>
                <Loader2 size={20} className="animate-spin" />
                <span className="text-sm font-medium">Saving changes...</span>
              </>
            ) : (
              <ArrowLeft size={20} />
            )}
          </button>
          {isRenaming ? (
            <form onSubmit={onRenameSubmit}>
              <input
                autoFocus
                type="text"
                value={newName}
                onChange={(e) => onNewNameChange(e.target.value)}
                onBlur={onRenameBlur}
                className="font-medium text-gray-900 dark:text-white bg-transparent px-2 py-1 border-2 border-indigo-500 rounded-md outline-none min-w-[200px]"
                style={{ width: `${Math.max(200, newName.length * 9 + 20)}px` }}
              />
            </form>
          ) : (
            <h1
              className="font-medium text-gray-900 dark:text-white px-2 py-1 hover:bg-gray-100 dark:hover:bg-neutral-800 rounded cursor-text"
              onDoubleClick={onRenameStart}
            >
              {drawingName}
            </h1>
          )}
        </div>
        <div className="flex items-center gap-3">
          {canEdit && autosaveFailing ? (
            <span
              className="flex items-center gap-1.5 text-xs font-semibold px-2 py-1 rounded-full bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-200 border border-red-200 dark:border-red-800"
              title="Your recent changes could not be saved. Check your connection and try again."
              role="status"
            >
              <CloudOff size={14} />
              Unsaved changes
            </span>
          ) : null}
          {!canEdit ? (
            <span className="text-xs font-semibold px-2 py-1 rounded-full bg-amber-100 text-amber-900 dark:bg-amber-900/30 dark:text-amber-200 border border-amber-200 dark:border-amber-800">
              Read-only
            </span>
          ) : null}
          {canEdit && id ? (
            <button
              ref={historyButtonRef}
              onClick={onHistoryOpen}
              className="ui-toolbar-button"
              title="Version History"
            >
              <History size={20} />
            </button>
          ) : null}
          {accessLevel === "owner" && id ? (
            <div className="relative inline-flex">
              <button
                ref={shareButtonRef}
                onClick={onShareOpen}
                className="ui-toolbar-button"
                title="Share"
              >
                <Share2 size={20} />
              </button>
            </div>
          ) : null}
          <button
            onClick={onToggleAutoHide}
            className="ui-toolbar-button"
            title={autoHideEnabled ? "Disable auto-hide" : "Enable auto-hide"}
          >
            {autoHideEnabled ? (
              <ChevronUp size={20} />
            ) : (
              <ChevronDown size={20} />
            )}
          </button>
          <div className="h-6 w-px bg-gray-300 dark:bg-gray-700" />
          <button
            onClick={onExportClick}
            className="ui-toolbar-button"
            title="Export drawing"
          >
            <Download size={20} />
          </button>
          <div className="h-6 w-px bg-gray-300 dark:bg-gray-700" />
          <div className="flex items-center">
            <CollaboratorAvatar user={me} label={`${me.name} (You)`} />
            {peers.length > 0 ? (
              <>
                <div className="h-6 w-px bg-gray-300 dark:bg-gray-700 mx-2" />
                <div className="flex items-center gap-2">
                  {peers.map((peer) => (
                    <CollaboratorAvatar
                      key={peer.id}
                      user={peer}
                      label={peer.name}
                      inactive={!peer.isActive}
                    />
                  ))}
                </div>
              </>
            ) : null}
          </div>
        </div>
      </header>
      {accessLevel === "owner" && id ? (
        <ShareModal
          drawingId={id}
          drawingName={drawingName}
          isOpen={isShareOpen}
          onClose={onCloseShare}
          anchorRef={shareButtonRef}
        />
      ) : null}
      <div
        ref={editorContainerRef}
        className="relative w-full flex-1"
        onPointerMoveCapture={(event) => {
          pointerRef.current = { x: event.clientX, y: event.clientY };
        }}
        onDropCapture={(event) => {
          if (isHistoryOpen) {
            event.preventDefault();
            event.stopPropagation();
            return;
          }
          onCanvasDropCapture(event);
        }}
        style={{
          height: isHeaderVisible ? "calc(100vh - 4rem)" : "100vh",
          marginTop: isHeaderVisible ? "4rem" : "0",
        }}
      >
        {loadError ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 bg-white dark:bg-neutral-950 px-6">
            <div className="text-center">
              <h2 className="text-xl font-bold text-gray-900 dark:text-gray-100">
                Unable to open drawing
              </h2>
              <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">
                {loadError}
              </p>
            </div>
            <button
              onClick={onNavigateHome}
              className="ui-button-secondary px-4"
            >
              Back to dashboard
            </button>
          </div>
        ) : initialData ? (
          <Excalidraw
            key={id}
            theme={theme === "dark" ? "dark" : "light"}
            langCode={langCode}
            initialData={initialData}
            onChange={handleChange}
            onPointerUp={handlePointerUp}
            onPaste={handlePaste}
            onPointerUpdate={onPointerUpdate}
            onLibraryChange={onLibraryChange}
            excalidrawAPI={(api: any) => {
              setExcalidrawApi(api);
              onSetExcalidrawAPI(api);
            }}
            UIOptions={UIOptions}
            validateEmbeddable={validateEmbeddableUrl}
            viewModeEnabled={!canEdit || isHistoryOpen}
          >
            <MainMenu>
              <MainMenu.Item onSelect={onToggleTheme} shortcut="Shift+Alt+D">
                {theme === "dark" ? "Light mode" : "Dark mode"}
              </MainMenu.Item>
              <MainMenu.DefaultItems.SaveAsImage />
              <MainMenu.DefaultItems.ClearCanvas />
              <MainMenu.DefaultItems.ChangeCanvasBackground />
              <MainMenu.DefaultItems.Help />
              <MainMenu.Separator />
              <MainMenu.ItemCustom>
                <StickyNoteMenu
                  selected={stickyColor}
                  disabled={!canEdit}
                  onAdd={addStickyNote}
                />
              </MainMenu.ItemCustom>
              <MainMenu.ItemCustom>
                <StickerPicker disabled={!canEdit} onAdd={addSticker} />
              </MainMenu.ItemCustom>
              <MainMenu.Item onSelect={() => setIsJiraOpen(true)}>
                Add Jira card
              </MainMenu.Item>
              {canEdit ? (
                <MainMenu.Item onSelect={() => void handleRefreshJira()}>
                  Refresh Jira cards
                </MainMenu.Item>
              ) : null}
              <MainMenu.ItemCustom>
                <GridStepSelector
                  gridStep={gridStep}
                  onChange={onSetGridStep}
                />
              </MainMenu.ItemCustom>
              <MainMenu.ItemCustom>
                <LanguageSelector
                  langCode={langCode}
                  onChange={onSetLangCode}
                />
              </MainMenu.ItemCustom>
            </MainMenu>
          </Excalidraw>
        ) : (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-gray-500 dark:text-gray-400">
            <span className="text-sm font-medium">
              {isSceneLoading ? "Loading drawing..." : "Preparing canvas..."}
            </span>
          </div>
        )}
        {jiraBadge && canEdit ? (
          <button
            type="button"
            data-testid="jira-refresh-button"
            title="Refresh from Jira"
            aria-label="Refresh Jira card"
            disabled={jiraRefreshing}
            onClick={() => void refreshGroups(new Set([jiraBadge.groupId]))}
            className="absolute z-[6] flex h-7 w-7 -translate-x-full -translate-y-[calc(100%+6px)] items-center justify-center rounded-lg border border-slate-300 bg-white text-slate-700 shadow hover:bg-slate-100 disabled:opacity-60 dark:border-neutral-600 dark:bg-neutral-800 dark:text-neutral-100"
            style={{ left: jiraBadge.left, top: jiraBadge.top }}
          >
            <RefreshCw
              size={14}
              className={jiraRefreshing ? "animate-spin" : ""}
            />
          </button>
        ) : null}
        {anchorIds && excalidrawApi ? (
          <ArrowAnchorOverlay api={excalidrawApi} />
        ) : null}
        {historyPreview ? (
          <HistoryPreviewCanvas
            snapshot={historyPreview}
            theme={theme}
            langCode={langCode}
          />
        ) : null}
        {mentionMenu}
        <Toaster position="bottom-center" />
        {isJiraOpen && canEdit ? (
          <JiraCardDialog
            excalidrawAPI={excalidrawApi}
            onClose={() => setIsJiraOpen(false)}
          />
        ) : null}
      </div>
    </div>
  );
};
