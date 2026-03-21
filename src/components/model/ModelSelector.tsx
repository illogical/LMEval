import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import type { ServerModelGroup, SelectedModel } from '../../hooks/useModelsByServer';
import { modelKey } from '../../hooks/useModelsByServer';
import './ModelSelector.css';

export interface ModelSelectorProps {
  servers: ServerModelGroup[];
  loading: boolean;
  selectedModels: SelectedModel[];
  onSelectionChange: (models: SelectedModel[]) => void;
  modelStatuses: Record<string, 'idle' | 'loading' | 'done' | 'error'>;
  onNavigateToModel?: (model: SelectedModel) => void;
}

interface FlatItem {
  type: 'server-header' | 'model';
  serverName: string;
  modelName?: string;
  isServerMatch?: boolean;
}

function StatusDot({ status }: { status?: 'idle' | 'loading' | 'done' | 'error' }) {
  if (!status || status === 'idle') return null;
  return <span className={`ms-status-dot ms-status-${status}`} aria-hidden="true" />;
}

export function ModelSelector({
  servers,
  loading,
  selectedModels,
  onSelectionChange,
  modelStatuses,
  onNavigateToModel,
}: ModelSelectorProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [focusedIdx, setFocusedIdx] = useState(-1);

  const containerRef = useRef<HTMLDivElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const [dropdownPos, setDropdownPos] = useState({ top: 0, left: 0, width: 0 });

  // Build flat list for keyboard navigation
  const flatItems = useMemo((): FlatItem[] => {
    const q = query.trim().toLowerCase();
    const result: FlatItem[] = [];

    for (const server of servers) {
      const serverMatches = q !== '' && server.name.toLowerCase().includes(q);
      const matchingModels = q === ''
        ? server.models
        : serverMatches
          ? server.models
          : server.models.filter(m => m.toLowerCase().includes(q));

      if (matchingModels.length === 0) continue;

      result.push({ type: 'server-header', serverName: server.name, isServerMatch: serverMatches });
      for (const m of matchingModels) {
        result.push({ type: 'model', serverName: server.name, modelName: m });
      }
    }
    return result;
  }, [servers, query]);

  // Reset focus to first model item when query changes
  useEffect(() => {
    const firstModel = flatItems.findIndex(i => i.type === 'model');
    setFocusedIdx(firstModel);
  }, [query, flatItems]);

  function findNextModelIdx(items: FlatItem[], current: number, dir: 1 | -1): number {
    let i = current + dir;
    while (i >= 0 && i < items.length) {
      if (items[i].type === 'model') return i;
      i += dir;
    }
    return -1;
  }

  function scrollToFocused(idx: number) {
    if (!listRef.current) return;
    const el = listRef.current.querySelector(`[data-idx="${idx}"]`) as HTMLElement | null;
    el?.scrollIntoView({ block: 'nearest' });
  }

  function openDropdown() {
    if (!containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    setDropdownPos({
      top: rect.bottom + 4,
      left: rect.left,
      width: Math.max(rect.width, 320),
    });
    setIsOpen(true);
    setQuery('');
    setTimeout(() => searchRef.current?.focus(), 0);
  }

  function closeDropdown() {
    setIsOpen(false);
    setQuery('');
    setFocusedIdx(-1);
  }

  function toggleModel(sel: SelectedModel) {
    const key = modelKey(sel);
    onSelectionChange(
      selectedModels.some(m => modelKey(m) === key)
        ? selectedModels.filter(m => modelKey(m) !== key)
        : [...selectedModels, sel]
    );
  }

  const handleModelClick = useCallback((item: FlatItem) => {
    const sel: SelectedModel = { serverName: item.serverName, modelName: item.modelName! };
    const key = modelKey(sel);
    toggleModel(sel);
    const status = modelStatuses[key];
    if ((status === 'done' || status === 'error') && onNavigateToModel) {
      onNavigateToModel(sel);
    }
  }, [selectedModels, modelStatuses, onNavigateToModel]); // eslint-disable-line react-hooks/exhaustive-deps

  function handleKeyDown(e: React.KeyboardEvent) {
    switch (e.key) {
      case 'ArrowDown': {
        e.preventDefault();
        const next = findNextModelIdx(flatItems, focusedIdx, 1);
        if (next !== -1) { setFocusedIdx(next); scrollToFocused(next); }
        break;
      }
      case 'ArrowUp': {
        e.preventDefault();
        const prev = findNextModelIdx(flatItems, focusedIdx, -1);
        if (prev !== -1) { setFocusedIdx(prev); scrollToFocused(prev); }
        break;
      }
      case 'Enter': {
        e.preventDefault();
        if (focusedIdx >= 0 && flatItems[focusedIdx]?.type === 'model') {
          handleModelClick(flatItems[focusedIdx]);
        }
        break;
      }
      case 'Escape': {
        e.preventDefault();
        closeDropdown();
        break;
      }
    }
  }

  // Close on click outside
  useEffect(() => {
    if (!isOpen) return;
    function onMouseDown(e: MouseEvent) {
      const t = e.target as Node;
      if (containerRef.current?.contains(t) || dropdownRef.current?.contains(t)) return;
      closeDropdown();
    }
    document.addEventListener('mousedown', onMouseDown);
    return () => document.removeEventListener('mousedown', onMouseDown);
  }, [isOpen]);

  // Close on window resize
  useEffect(() => {
    if (!isOpen) return;
    window.addEventListener('resize', closeDropdown);
    return () => window.removeEventListener('resize', closeDropdown);
  }, [isOpen]);

  return (
    <div className="model-selector" ref={containerRef}>
      {/* Trigger */}
      <div
        className="ms-trigger"
        onClick={openDropdown}
        role="button"
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        tabIndex={0}
        onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDropdown(); } }}
      >
        {selectedModels.length === 0 && !loading && (
          <span className="ms-placeholder">Select a model…</span>
        )}
        {loading && <span className="ms-loading">Loading models…</span>}
        {selectedModels.map(sel => (
          <span key={modelKey(sel)} className="ms-chip">
            <StatusDot status={modelStatuses[modelKey(sel)]} />
            <span className="ms-chip-label">
              <span className="ms-chip-model">{sel.modelName}</span>
              <span className="ms-chip-server">{sel.serverName}</span>
            </span>
            <button
              className="ms-chip-remove"
              aria-label={`Remove ${sel.modelName}`}
              onClick={e => { e.stopPropagation(); onSelectionChange(selectedModels.filter(m => modelKey(m) !== modelKey(sel))); }}
            >
              ×
            </button>
          </span>
        ))}
        {!loading && (
          <button
            className="ms-add-btn"
            aria-label="Add model"
            onClick={e => { e.stopPropagation(); openDropdown(); }}
            tabIndex={-1}
          >
            +
          </button>
        )}
      </div>

      {/* Dropdown */}
      {isOpen && (
        <div
          className="ms-dropdown"
          ref={dropdownRef}
          style={{ position: 'fixed', top: dropdownPos.top, left: dropdownPos.left, width: dropdownPos.width }}
        >
          <input
            ref={searchRef}
            className="ms-search"
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Filter models…"
            aria-label="Filter models"
            aria-autocomplete="list"
          />
          <ul
            className="ms-list"
            ref={listRef}
            role="listbox"
            aria-multiselectable="true"
            aria-label="Available models"
          >
            {flatItems.length === 0 && (
              <li className="ms-empty">
                {servers.length === 0 ? 'No models available' : `No models match "${query}"`}
              </li>
            )}
            {flatItems.map((item, idx) => {
              if (item.type === 'server-header') {
                return (
                  <li
                    key={`h-${item.serverName}`}
                    className={`ms-group-header${item.isServerMatch ? ' ms-group-match' : ''}`}
                    role="presentation"
                  >
                    {item.serverName}
                  </li>
                );
              }
              const itemKey = `${item.serverName}::${item.modelName}`;
              const isSelected = selectedModels.some(m => modelKey(m) === itemKey);
              return (
                <li
                  key={`m-${item.serverName}-${item.modelName}`}
                  data-idx={idx}
                  className={[
                    'ms-item',
                    idx === focusedIdx ? 'ms-item-focused' : '',
                    isSelected ? 'ms-item-selected' : '',
                  ].filter(Boolean).join(' ')}
                  role="option"
                  aria-selected={isSelected}
                  onMouseEnter={() => setFocusedIdx(idx)}
                  onClick={() => handleModelClick(item)}
                >
                  <span className="ms-checkmark">{isSelected ? '✓' : ''}</span>
                  <span className="ms-item-name">{item.modelName}</span>
                  <StatusDot status={modelStatuses[itemKey]} />
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
