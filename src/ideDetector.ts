import * as vscode from 'vscode';

/**
 * Supported IDE types where this extension can run.
 */
export const IDE_TYPE = {
  VSCODE: 'vscode',
  CURSOR: 'cursor',
  UNKNOWN: 'unknown',
} as const;

export type IdeType = (typeof IDE_TYPE)[keyof typeof IDE_TYPE];

/**
 * Detect which IDE is running by inspecting vscode.env.appName.
 * Cursor reports "Cursor" while VS Code reports "Visual Studio Code".
 */
export function detectIde(): IdeType {
  const appName = vscode.env.appName.toLowerCase();
  if (appName.includes('cursor')) {
    return IDE_TYPE.CURSOR;
  }
  if (appName.includes('visual studio code') || appName.includes('vscode')) {
    return IDE_TYPE.VSCODE;
  }
  return IDE_TYPE.UNKNOWN;
}

/**
 * Get a human-readable IDE display name.
 */
export function getIdeDisplayName(ide: IdeType): string {
  switch (ide) {
    case IDE_TYPE.CURSOR:
      return 'Cursor';
    case IDE_TYPE.VSCODE:
      return 'VS Code';
    default:
      return vscode.env.appName;
  }
}
