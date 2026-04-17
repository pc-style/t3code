import { type KeybindingCommand, THREAD_JUMP_KEYBINDING_COMMANDS } from "@t3tools/contracts";
import { KeyboardIcon } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { resolveAndPersistPreferredEditor } from "../../editorPreferences";
import {
  buildKeybindingRuleFromResolved,
  encodeWhenAst,
  findResolvedKeybindingRuleForCommand,
  formatShortcutLabel,
  keybindingValueFromEvent,
} from "../../keybindings";
import { ensureLocalApi } from "../../localApi";
import {
  useServerAvailableEditors,
  useServerKeybindings,
  useServerKeybindingsConfigPath,
} from "../../rpc/serverState";
import { Button } from "../ui/button";
import {
  SettingResetButton,
  SettingsPageContainer,
  SettingsRow,
  SettingsSection,
} from "./settingsLayout";

const KEYBINDING_GROUPS: ReadonlyArray<{
  title: string;
  commands: ReadonlyArray<{
    command: KeybindingCommand;
    label: string;
    description: string;
  }>;
}> = [
  {
    title: "Workspace",
    commands: [
      {
        command: "commandPalette.toggle",
        label: "Command palette",
        description: "Open the global command palette from the main workspace.",
      },
      {
        command: "chat.new",
        label: "New chat",
        description: "Start a new thread while preserving the current environment state.",
      },
      {
        command: "chat.newLocal",
        label: "New local chat",
        description: "Start a new thread in a fresh local or worktree environment.",
      },
      {
        command: "editor.openFavorite",
        label: "Open in editor",
        description: "Open the active project in the last-used editor.",
      },
      {
        command: "diff.toggle",
        label: "Toggle diff",
        description: "Open or close the diff panel outside terminal focus.",
      },
    ],
  },
  {
    title: "Terminal",
    commands: [
      {
        command: "terminal.toggle",
        label: "Toggle terminal",
        description: "Show or hide the terminal drawer.",
      },
      {
        command: "terminal.split",
        label: "Split terminal",
        description: "Create another terminal pane in the focused terminal context.",
      },
      {
        command: "terminal.new",
        label: "New terminal",
        description: "Open a fresh terminal tab in the focused terminal context.",
      },
      {
        command: "terminal.close",
        label: "Close terminal",
        description: "Close the active terminal in the focused terminal context.",
      },
    ],
  },
  {
    title: "Thread navigation",
    commands: [
      {
        command: "thread.previous",
        label: "Previous thread",
        description: "Move to the previous thread in the current list.",
      },
      {
        command: "thread.next",
        label: "Next thread",
        description: "Move to the next thread in the current list.",
      },
      ...THREAD_JUMP_KEYBINDING_COMMANDS.map((command, index) => ({
        command,
        label: `Jump to thread ${index + 1}`,
        description: `Jump directly to thread slot ${index + 1}.`,
      })),
    ],
  },
];

function describeWhenExpression(expression: string | null): string {
  if (!expression) return "Active everywhere.";
  if (expression === "terminalFocus") return "Active when a terminal is focused.";
  if (expression === "!(terminalFocus)") return "Active when a terminal is not focused.";
  if (expression === "terminalOpen") return "Active when the terminal drawer is open.";
  return `Active when ${expression}.`;
}

export function KeybindingsSettings() {
  const keybindings = useServerKeybindings();
  const keybindingsConfigPath = useServerKeybindingsConfigPath();
  const availableEditors = useServerAvailableEditors();
  const [recordingCommand, setRecordingCommand] = useState<KeybindingCommand | null>(null);
  const [savingCommand, setSavingCommand] = useState<KeybindingCommand | null>(null);
  const [openingFile, setOpeningFile] = useState(false);
  const [errorByCommand, setErrorByCommand] = useState<Partial<Record<KeybindingCommand, string>>>(
    {},
  );
  const [openFileError, setOpenFileError] = useState<string | null>(null);

  const bindingsByCommand = useMemo(() => {
    const map = new Map<
      KeybindingCommand,
      ReturnType<typeof findResolvedKeybindingRuleForCommand>
    >();
    for (const group of KEYBINDING_GROUPS) {
      for (const item of group.commands) {
        map.set(item.command, findResolvedKeybindingRuleForCommand(keybindings, item.command));
      }
    }
    return map;
  }, [keybindings]);

  useEffect(() => {
    if (!recordingCommand) return;

    const onKeyDown = (event: KeyboardEvent) => {
      event.preventDefault();
      event.stopPropagation();
      if (event.repeat) return;

      if (
        event.key === "Escape" &&
        !event.metaKey &&
        !event.ctrlKey &&
        !event.shiftKey &&
        !event.altKey
      ) {
        setRecordingCommand(null);
        setErrorByCommand((existing) => ({ ...existing, [recordingCommand]: undefined }));
        return;
      }

      const nextKey = keybindingValueFromEvent(event);
      if (!nextKey) {
        setErrorByCommand((existing) => ({
          ...existing,
          [recordingCommand]: "Use at least one non-modifier key.",
        }));
        return;
      }

      const existingBinding = bindingsByCommand.get(recordingCommand);
      if (!existingBinding) {
        setRecordingCommand(null);
        setErrorByCommand((existing) => ({
          ...existing,
          [recordingCommand]: "Current binding could not be resolved.",
        }));
        return;
      }

      setSavingCommand(recordingCommand);
      void ensureLocalApi()
        .server.upsertKeybinding(buildKeybindingRuleFromResolved(existingBinding, nextKey))
        .then(() => {
          setErrorByCommand((existing) => ({ ...existing, [recordingCommand]: undefined }));
          setRecordingCommand((current) => (current === recordingCommand ? null : current));
        })
        .catch((error: unknown) => {
          setErrorByCommand((existing) => ({
            ...existing,
            [recordingCommand]: error instanceof Error ? error.message : "Unable to save shortcut.",
          }));
        })
        .finally(() => {
          setSavingCommand((current) => (current === recordingCommand ? null : current));
        });
    };

    window.addEventListener("keydown", onKeyDown, { capture: true });
    return () => {
      window.removeEventListener("keydown", onKeyDown, { capture: true });
    };
  }, [bindingsByCommand, recordingCommand]);

  const openKeybindingsFile = () => {
    if (!keybindingsConfigPath) return;
    setOpenFileError(null);
    setOpeningFile(true);

    const editor = resolveAndPersistPreferredEditor(availableEditors ?? []);
    if (!editor) {
      setOpenFileError("No available editors found.");
      setOpeningFile(false);
      return;
    }

    void ensureLocalApi()
      .shell.openInEditor(keybindingsConfigPath, editor)
      .catch((error: unknown) => {
        setOpenFileError(
          error instanceof Error ? error.message : "Unable to open keybindings file.",
        );
      })
      .finally(() => {
        setOpeningFile(false);
      });
  };

  return (
    <SettingsPageContainer>
      <SettingsSection
        title="Keybindings"
        icon={<KeyboardIcon className="size-3.5" />}
        headerAction={
          <span className="text-[11px] text-muted-foreground">
            Click a shortcut button, then press the keys you want to save.
          </span>
        }
      >
        {KEYBINDING_GROUPS.map((group) => (
          <div key={group.title} className="border-t border-border/60 first:border-t-0">
            <div className="px-4 pt-4 sm:px-5">
              <h3 className="text-[11px] font-semibold uppercase tracking-[0.08em] text-foreground/45">
                {group.title}
              </h3>
            </div>
            {group.commands.map((item) => {
              const binding = bindingsByCommand.get(item.command) ?? null;
              const whenExpression = binding?.whenAst ? encodeWhenAst(binding.whenAst) : null;
              const isRecording = recordingCommand === item.command;
              const isSaving = savingCommand === item.command;
              const error = errorByCommand[item.command] ?? null;

              return (
                <SettingsRow
                  key={item.command}
                  title={item.label}
                  description={item.description}
                  status={
                    <>
                      <span className="block">
                        {binding
                          ? describeWhenExpression(whenExpression)
                          : "No active binding found in the current config."}
                      </span>
                      {error ? <span className="mt-1 block text-destructive">{error}</span> : null}
                    </>
                  }
                  resetAction={
                    isRecording ? (
                      <SettingResetButton
                        label={`${item.label} capture`}
                        onClick={() => setRecordingCommand(null)}
                      />
                    ) : null
                  }
                  control={
                    <Button
                      size="xs"
                      variant={isRecording ? "default" : "outline"}
                      disabled={!binding || isSaving}
                      onClick={() =>
                        setRecordingCommand((current) =>
                          current === item.command ? null : item.command,
                        )
                      }
                    >
                      {isSaving
                        ? "Saving..."
                        : isRecording
                          ? "Listening..."
                          : binding
                            ? formatShortcutLabel(binding.shortcut)
                            : "Unavailable"}
                    </Button>
                  }
                />
              );
            })}
          </div>
        ))}
      </SettingsSection>

      <SettingsSection title="Advanced">
        <SettingsRow
          title="Edit keybindings.json"
          description="Open the persisted config file for unsupported keys, script bindings, or manual edits."
          status={
            <>
              <span className="block break-all font-mono text-[11px] text-foreground">
                {keybindingsConfigPath ?? "Resolving keybindings path..."}
              </span>
              {openFileError ? (
                <span className="mt-1 block text-destructive">{openFileError}</span>
              ) : (
                <span className="mt-1 block">Changes reload automatically after save.</span>
              )}
            </>
          }
          control={
            <Button
              size="xs"
              variant="outline"
              disabled={!keybindingsConfigPath || openingFile}
              onClick={openKeybindingsFile}
            >
              {openingFile ? "Opening..." : "Open file"}
            </Button>
          }
        />
      </SettingsSection>
    </SettingsPageContainer>
  );
}
