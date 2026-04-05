import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';

import {
  CURSOR_IDLE_TIMEOUT_MS,
  CURSOR_POLL_INTERVAL_MS,
  CURSOR_PROJECTS_DIR,
  CURSOR_TRANSCRIPTS_SUBDIR,
} from '../constants.js';
import { TOOL_DONE_DELAY_MS } from '../../server/src/constants.js';
import type { AgentState, AgentType } from '../types.js';
import type { AdapterContext } from './types.js';

/**
 * Cursor background-agent adapter for Pixel Agents.
 *
 * Cursor background agents write conversation + tool-use JSONL transcripts to:
 *   ~/.cursor/projects/<project-hash>/agent-transcripts/<session-id>/<session-id>.jsonl
 *
 * The project hash is the workspace path with non-alphanumeric chars (except `-`)
 * replaced by `-`, and the leading slash stripped:
 *   /Users/clawd/projects/foo  →  Users-clawd-projects-foo
 *
 * Record format (differs from Claude Code):
 *   { "role": "assistant", "message": { "content": [ { "type": "tool_use", "name": "Shell", "input": {...} } ] } }
 *   { "role": "assistant", "message": { "content": [ { "type": "text", "text": "..." } ] } }
 *   { "role": "user",      "message": { "content": [ { "type": "text", "text": "<user_query>..." } ] } }
 *
 * Note: tool results are NOT written to the JSONL. A new user message signals turn end.
 *
 * This adapter:
 * 1. Derives the project hash for the current workspace.
 * 2. Scans agent-transcripts/ for existing session dirs; creates one agent per session.
 * 3. Watches the transcripts dir for new sessions appearing.
 * 4. Polls each JSONL file (500ms) and parses new lines to drive tool animations.
 */
export class CursorAdapter {
  readonly agentType: AgentType = 'cursor';

  start(context: AdapterContext): vscode.Disposable {
    const transcriptsDir = getCursorTranscriptsDir();
    if (!transcriptsDir) {
      console.log('[Pixel Agents] No workspace folder open — Cursor adapter inactive');
      return { dispose: () => {} };
    }

    console.log(`[Pixel Agents] Cursor adapter scanning: ${transcriptsDir}`);

    const { agents, nextAgentIdRef, webview, persistAgents } = context;
    const disposables: vscode.Disposable[] = [];

    // Map from sessionId → session state for polling
    const sessions = new Map<string, SessionState>();

    // Scan existing sessions and start watching for new ones
    scanAndWatch(transcriptsDir, sessions, agents, nextAgentIdRef, webview, persistAgents);

    // Poll all tracked sessions periodically
    const pollTimer = setInterval(() => {
      for (const [sessionId, session] of sessions) {
        pollSession(sessionId, session, agents, webview);
      }
    }, CURSOR_POLL_INTERVAL_MS);

    // Watch transcripts dir for new session subdirectories
    let dirWatcher: fs.FSWatcher | null = null;
    try {
      if (fs.existsSync(transcriptsDir)) {
        dirWatcher = fs.watch(transcriptsDir, (_event, filename) => {
          if (!filename) return;
          const sessionId = filename;
          if (sessions.has(sessionId)) return;
          const sessionDir = path.join(transcriptsDir, sessionId);
          const jsonlFile = path.join(sessionDir, `${sessionId}.jsonl`);
          if (fs.existsSync(jsonlFile)) {
            const agentId = createCursorAgent(
              sessionId,
              transcriptsDir,
              agents,
              nextAgentIdRef,
              webview,
              persistAgents,
            );
            sessions.set(sessionId, {
              jsonlFile,
              agentId,
              fileOffset: 0,
              lineBuffer: '',
              idleTimer: null,
              activeToolId: null,
            });
            console.log(`[Pixel Agents] Cursor: new session ${sessionId} → agent ${agentId}`);
          }
        });
      }
    } catch {
      // Directory may not exist yet; polling will pick up sessions when they appear
    }

    disposables.push({
      dispose: () => {
        clearInterval(pollTimer);
        dirWatcher?.close();
        for (const session of sessions.values()) {
          if (session.idleTimer) clearTimeout(session.idleTimer);
        }
        sessions.clear();
      },
    });

    return vscode.Disposable.from(...disposables);
  }
}

/** Per-session polling state */
interface SessionState {
  jsonlFile: string;
  agentId: number;
  fileOffset: number;
  lineBuffer: string;
  idleTimer: ReturnType<typeof setTimeout> | null;
  /** Current synthetic tool ID for the active tool (null when idle) */
  activeToolId: string | null;
}

/**
 * Compute the Cursor project hash for the current workspace.
 * Cursor strips the leading slash and replaces [^a-zA-Z0-9-] with '-'.
 */
function getCursorProjectHash(workspacePath: string): string {
  return workspacePath.replace(/^\//, '').replace(/[^a-zA-Z0-9-]/g, '-');
}

/** Return the agent-transcripts dir for the current workspace, or undefined if no workspace open. */
function getCursorTranscriptsDir(): string | undefined {
  const wsPath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (!wsPath) return undefined;
  const hash = getCursorProjectHash(wsPath);
  return path.join(os.homedir(), CURSOR_PROJECTS_DIR, hash, CURSOR_TRANSCRIPTS_SUBDIR);
}

/** Scan for existing session dirs and register them. Also initialises dir watching. */
function scanAndWatch(
  transcriptsDir: string,
  sessions: Map<string, SessionState>,
  agents: Map<number, AgentState>,
  nextAgentIdRef: { current: number },
  webview: vscode.Webview | undefined,
  persistAgents: () => void,
): void {
  if (!fs.existsSync(transcriptsDir)) return;
  let entries: string[];
  try {
    entries = fs.readdirSync(transcriptsDir);
  } catch {
    return;
  }
  for (const sessionId of entries) {
    const jsonlFile = path.join(transcriptsDir, sessionId, `${sessionId}.jsonl`);
    if (!fs.existsSync(jsonlFile)) continue;
    const agentId = createCursorAgent(
      sessionId,
      transcriptsDir,
      agents,
      nextAgentIdRef,
      webview,
      persistAgents,
    );
    // Seek to end — don't replay history for sessions already on disk
    let startOffset = 0;
    try {
      startOffset = fs.statSync(jsonlFile).size;
    } catch {
      /* ignore */
    }
    sessions.set(sessionId, {
      jsonlFile,
      agentId,
      fileOffset: startOffset,
      lineBuffer: '',
      idleTimer: null,
      activeToolId: null,
    });
  }
}

/** Read and process any new bytes appended to a session's JSONL file. */
function pollSession(
  _sessionId: string,
  session: SessionState,
  agents: Map<number, AgentState>,
  webview: vscode.Webview | undefined,
): void {
  let stat: fs.Stats;
  try {
    stat = fs.statSync(session.jsonlFile);
  } catch {
    return;
  }
  if (stat.size <= session.fileOffset) return;

  let chunk: string;
  try {
    const fd = fs.openSync(session.jsonlFile, 'r');
    const buf = Buffer.allocUnsafe(stat.size - session.fileOffset);
    const bytesRead = fs.readSync(fd, buf, 0, buf.length, session.fileOffset);
    fs.closeSync(fd);
    session.fileOffset += bytesRead;
    chunk = buf.slice(0, bytesRead).toString('utf8');
  } catch {
    return;
  }

  const agent = agents.get(session.agentId);
  if (!agent) return;

  // Split on newlines, carrying a partial line in lineBuffer
  const raw = session.lineBuffer + chunk;
  const lines = raw.split('\n');
  session.lineBuffer = lines.pop() ?? '';

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    processLine(trimmed, session, agent, webview);
  }
}

/** Map a Cursor tool name to a human-readable status string. */
function formatCursorToolStatus(toolName: string, input: Record<string, unknown>): string {
  const str = (v: unknown): string => (typeof v === 'string' ? v : '');
  const base = (p: unknown): string => (typeof p === 'string' && p ? path.basename(p) : '');
  const name = toolName.toLowerCase();

  if (name === 'shell' || name === 'bash') {
    const cmd = str(input.command);
    const short = cmd.length > 40 ? cmd.slice(0, 37) + '…' : cmd;
    return short || 'Running command';
  }
  if (name === 'readfile' || name === 'read') return `Reading ${base(input.path)}`;
  if (name === 'writefile' || name === 'write') return `Writing ${base(input.path)}`;
  if (name === 'applypatch' || name === 'edit') return `Editing file`;
  if (name === 'glob') return `Searching ${str(input.glob_pattern) || '**'}`;
  if (name === 'rg' || name === 'grep') return `Searching for ${str(input.pattern) || '…'}`;
  if (name === 'todowrite') return 'Updating tasks';
  if (name === 'managepullrequest') return 'Managing PR';
  return `${toolName}`;
}

/** Process one parsed JSONL line from a Cursor transcript. */
function processLine(
  line: string,
  session: SessionState,
  agent: AgentState,
  webview: vscode.Webview | undefined,
): void {
  let record: { role?: string; message?: { content?: unknown[] } };
  try {
    record = JSON.parse(line) as typeof record;
  } catch {
    return;
  }

  const role = record.role;
  const content = record.message?.content;
  if (!Array.isArray(content)) return;

  // Reset idle timer on any activity
  resetIdleTimer(session, agent, webview);

  if (role === 'assistant') {
    for (const item of content) {
      if (!item || typeof item !== 'object') continue;
      const typedItem = item as { type?: string; name?: string; input?: Record<string, unknown> };
      if (typedItem.type === 'tool_use') {
        const toolName = typedItem.name ?? 'Tool';
        const input = typedItem.input ?? {};
        const toolId = `cursor-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
        const status = formatCursorToolStatus(toolName, input);

        // Close previous tool if still open
        if (session.activeToolId) {
          const prevId = session.activeToolId;
          setTimeout(() => {
            webview?.postMessage({ type: 'agentToolDone', id: agent.id, toolId: prevId });
          }, TOOL_DONE_DELAY_MS);
        }

        session.activeToolId = toolId;
        agent.activeToolIds.add(toolId);
        agent.activeToolStatuses.set(toolId, status);

        webview?.postMessage({ type: 'agentStatus', id: agent.id, status: 'active' });
        webview?.postMessage({ type: 'agentToolStart', id: agent.id, toolId, status });
      }
      // 'text' thinking lines keep the agent visually active — idle timer handles transition
    }
  } else if (role === 'user') {
    // A new user message means the agent finished a turn and is now waiting for input
    finishTurn(session, agent, webview);
  }
}

/** Close the active tool and mark agent as waiting. */
function finishTurn(
  session: SessionState,
  agent: AgentState,
  webview: vscode.Webview | undefined,
): void {
  if (session.idleTimer) {
    clearTimeout(session.idleTimer);
    session.idleTimer = null;
  }
  const toolId = session.activeToolId;
  session.activeToolId = null;
  agent.activeToolIds.clear();
  agent.activeToolStatuses.clear();

  if (toolId) {
    setTimeout(() => {
      webview?.postMessage({ type: 'agentToolDone', id: agent.id, toolId });
      webview?.postMessage({ type: 'agentStatus', id: agent.id, status: 'waiting' });
    }, TOOL_DONE_DELAY_MS);
  } else {
    webview?.postMessage({ type: 'agentStatus', id: agent.id, status: 'waiting' });
  }
}

/** Restart the idle timer that fires when the agent goes silent. */
function resetIdleTimer(
  session: SessionState,
  agent: AgentState,
  webview: vscode.Webview | undefined,
): void {
  if (session.idleTimer) clearTimeout(session.idleTimer);
  session.idleTimer = setTimeout(() => {
    session.idleTimer = null;
    finishTurn(session, agent, webview);
  }, CURSOR_IDLE_TIMEOUT_MS);
}

/** Creates a Cursor agent entry in the shared agents map and notifies the webview. */
function createCursorAgent(
  sessionId: string,
  transcriptsDir: string,
  agents: Map<number, AgentState>,
  nextAgentIdRef: { current: number },
  webview: vscode.Webview | undefined,
  persistAgents: () => void,
): number {
  const id = nextAgentIdRef.current++;
  const projectDir = path.dirname(transcriptsDir); // ~/.cursor/projects/<hash>
  const jsonlFile = path.join(transcriptsDir, sessionId, `${sessionId}.jsonl`);

  const agent: AgentState = {
    id,
    providerId: 'cursor',
    sessionId,
    isExternal: true,
    projectDir,
    jsonlFile,
    agentType: 'cursor',
    fileOffset: 0,
    lineBuffer: '',
    activeToolIds: new Set(),
    activeToolStatuses: new Map(),
    activeToolNames: new Map(),
    activeSubagentToolIds: new Map(),
    activeSubagentToolNames: new Map(),
    backgroundAgentToolIds: new Set(),
    isWaiting: false,
    permissionSent: false,
    hadToolsInTurn: false,
    lastDataAt: 0,
    linesProcessed: 0,
    seenUnknownRecordTypes: new Set(),
    hookDelivered: false,
  };

  agents.set(id, agent);
  persistAgents();

  console.log(`[Pixel Agents] Cursor agent ${id}: session ${sessionId.slice(0, 8)}…`);
  webview?.postMessage({ type: 'agentCreated', id, isExternal: true });

  return id;
}
