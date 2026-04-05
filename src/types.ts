import type * as vscode from 'vscode';

export type AgentType = 'claude' | 'codex' | 'antigravity' | 'copilot' | 'copilot-cli';

export interface AgentState {
  id: number;
  /** Backend/provider identifier (e.g. 'claude', 'codex', 'cursor'). */
  providerId: string;
  sessionId: string;
  /** Terminal reference — undefined for extension panel sessions */
  terminalRef?: vscode.Terminal;
  /** Whether this agent was detected from an external source (VS Code extension panel, etc.) */
  isExternal: boolean;
  projectDir: string;
  jsonlFile: string;
  agentType: AgentType;
  fileOffset: number;
  lineBuffer: string;
  activeToolIds: Set<string>;
  activeToolStatuses: Map<string, string>;
  activeToolNames: Map<string, string>;
  activeSubagentToolIds: Map<string, Set<string>>; // parentToolId → active sub-tool IDs
  activeSubagentToolNames: Map<string, Map<string, string>>; // parentToolId → (subToolId → toolName)
  backgroundAgentToolIds: Set<string>; // tool IDs for run_in_background Agent calls (stay alive until queue-operation)
  isWaiting: boolean;
  permissionSent: boolean;
  hadToolsInTurn: boolean;
  /** Workspace folder name (only set for multi-root workspaces) */
  folderName?: string;
  /** Timestamp of last JSONL data received (ms since epoch) */
  lastDataAt: number;
  /** Total JSONL lines processed for this agent */
  linesProcessed: number;
  /** Set of record.type values we've already warned about (prevents log spam) */
  seenUnknownRecordTypes: Set<string>;
  /** Whether a hook event has been delivered for this agent (suppresses heuristic timers) */
  hookDelivered: boolean;
}

export interface PersistedAgent {
  id: number;
  /** Backend/provider identifier used for hook routing. */
  providerId?: string;
  sessionId?: string;
  /** Terminal name — empty string for extension panel sessions */
  terminalName: string;
  /** Whether this agent was detected from an external source */
  isExternal?: boolean;
  jsonlFile: string;
  projectDir: string;
  agentType?: AgentType;
  /** Workspace folder name (only set for multi-root workspaces) */
  folderName?: string;
}
