import { useEffect, useRef, useState } from 'react';

import type { WorkspaceFolder } from '../hooks/useExtensionMessages.js';
import { Button } from './ui/Button.js';
import { Dropdown, DropdownItem } from './ui/Dropdown.js';

interface BottomToolbarProps {
  isEditMode: boolean;
  onOpenAgent: (agentType: string, folderPath?: string) => void;
  onToggleEditMode: () => void;
  isSettingsOpen: boolean;
  onToggleSettings: () => void;
  workspaceFolders: WorkspaceFolder[];
}

export function BottomToolbar({
  isEditMode,
  onOpenAgent,
  onToggleEditMode,
  isSettingsOpen,
  onToggleSettings,
  workspaceFolders,
}: BottomToolbarProps) {
  const [isAgentMenuOpen, setIsAgentMenuOpen] = useState(false);
  const [isFolderPickerOpen, setIsFolderPickerOpen] = useState(false);
  const [pendingAgentType, setPendingAgentType] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  // Close menus on outside click
  useEffect(() => {
    if (!isAgentMenuOpen && !isFolderPickerOpen) return;
    const handleClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setIsAgentMenuOpen(false);
        setIsFolderPickerOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [isAgentMenuOpen, isFolderPickerOpen]);

  const hasMultipleFolders = workspaceFolders.length > 1;

  const handleAgentClick = () => {
    setIsAgentMenuOpen((v) => !v);
    setIsFolderPickerOpen(false);
  };

  const handleAgentSelect = (type: string) => {
    if (hasMultipleFolders) {
      setPendingAgentType(type);
      setIsAgentMenuOpen(false);
      setIsFolderPickerOpen(true);
    } else {
      onOpenAgent(type);
      setIsAgentMenuOpen(false);
    }
  };

  const handleFolderSelect = (folder: WorkspaceFolder) => {
    setIsFolderPickerOpen(false);
    const agentType = pendingAgentType ?? 'claude';
    setPendingAgentType(null);
    onOpenAgent(agentType, folder.path);
  };

  const agentTypes = [
    { id: 'claude', label: 'Claude' },
    { id: 'codex', label: 'Codex' },
    { id: 'antigravity', label: 'Antigravity' },
    { id: 'copilot-cli', label: 'Copilot CLI' },
    { id: 'opencode', label: 'Opencode' },
    { id: 'vscode-terminal', label: 'VS Code Terminal' },
  ];

  return (
    <div className="absolute bottom-10 left-10 z-20 flex items-center gap-4 pixel-panel p-4">
      <div ref={menuRef} className="relative">
        <Button
          variant="accent"
          onClick={handleAgentClick}
          className={
            isAgentMenuOpen || isFolderPickerOpen
              ? 'bg-accent-bright'
              : 'bg-accent hover:bg-accent-bright'
          }
        >
          + Agent
        </Button>
        <Dropdown isOpen={isAgentMenuOpen}>
          {agentTypes.map((agent) => (
            <DropdownItem key={agent.id} onClick={() => handleAgentSelect(agent.id)}>
              {agent.label}
            </DropdownItem>
          ))}
        </Dropdown>
        <Dropdown isOpen={isFolderPickerOpen} className="min-w-128">
          {workspaceFolders.map((folder) => (
            <DropdownItem
              key={folder.path}
              onClick={() => handleFolderSelect(folder)}
              className="text-base"
            >
              {folder.name}
            </DropdownItem>
          ))}
        </Dropdown>
      </div>
      <Button
        variant={isEditMode ? 'active' : 'default'}
        onClick={onToggleEditMode}
        title="Edit office layout"
      >
        Layout
      </Button>
      <Button
        variant={isSettingsOpen ? 'active' : 'default'}
        onClick={onToggleSettings}
        title="Settings"
      >
        Settings
      </Button>
    </div>
  );
}
