import { useEffect, useRef, useState } from 'react';
import { Download, Plus } from 'lucide-react';
import {
  Badge,
  Button,
  Dialog,
  EmptyState,
  Select,
  Tag,
  Textarea,
  useToast,
} from '../../components/ui';
import { extractMeetingMemory } from '../../lib/copilot/memoryExtractor';
import { appendAuditEvent } from '../../lib/runtime/auditEvents';
import { useSessionStore } from '../../store/sessionStore';
import './actions.css';

type KanbanColumn = 'suggested' | 'queued' | 'running' | 'done';
type ActionSource = 'meeting' | 'knowledge' | 'manual';
type ActionProvider = 'groq' | 'openai' | 'anthropic' | 'system';

type ActionCard = {
  id: string;
  title: string;
  source: ActionSource;
  provider: ActionProvider;
  column: KanbanColumn;
};

const COLUMNS: { id: KanbanColumn; label: string }[] = [
  { id: 'suggested', label: 'Suggested' },
  { id: 'queued', label: 'Queued' },
  { id: 'running', label: 'Running' },
  { id: 'done', label: 'Done' },
];

const SOURCE_BADGE_VARIANT: Record<ActionSource, 'gold' | 'blue' | 'neutral'> = {
  meeting: 'gold',
  knowledge: 'blue',
  manual: 'neutral',
};

function exportActionItems(actions: ActionCard[]) {
  const rows = [
    'Title,Source,Provider,Status',
    ...actions.map(
      (a) => `"${a.title.replace(/"/g, '""')}","${a.source}","${a.provider}","${a.column}"`,
    ),
  ];
  const csv = rows.join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `meetingmind-actions-${new Date().toISOString().slice(0, 10)}.csv`;
  anchor.click();
  URL.revokeObjectURL(url);
  appendAuditEvent('export_generated', {
    format: 'csv',
    source: 'action-items',
    actionCount: actions.length,
  });
}

function seedFromSession(
  transcript: ReturnType<typeof useSessionStore.getState>['transcript'],
  report: ReturnType<typeof useSessionStore.getState>['report'],
): ActionCard[] {
  const extracted = extractMeetingMemory(transcript);
  const rawItems = report?.actionItems ?? extracted.actionItems.map((item) => item.text);
  return rawItems.map((text, i) => ({
    id: `session-${i}-${Date.now()}`,
    title: text,
    source: 'meeting' as ActionSource,
    provider: 'groq' as ActionProvider,
    column: 'suggested' as KanbanColumn,
  }));
}

export function ActionItemsPage() {
  const toast = useToast();
  const transcript = useSessionStore((state) => state.transcript);
  const report = useSessionStore((state) => state.report);

  const [cards, setCards] = useState<ActionCard[]>(() => seedFromSession(transcript, report));
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [dragOverCol, setDragOverCol] = useState<KanbanColumn | null>(null);
  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newProvider, setNewProvider] = useState<ActionProvider>('groq');
  const executeTimersRef = useRef<Set<ReturnType<typeof setTimeout>>>(new Set());

  useEffect(
    () => () => {
      for (const t of executeTimersRef.current) clearTimeout(t);
      executeTimersRef.current.clear();
    },
    [],
  );

  function moveCard(id: string, toColumn: KanbanColumn) {
    setCards((prev) => prev.map((c) => (c.id === id ? { ...c, column: toColumn } : c)));
  }

  function executeCard(id: string) {
    setCards((prev) => prev.map((c) => (c.id === id ? { ...c, column: 'running' } : c)));
    toast.show({ title: 'Action executing…', variant: 'info' });
    const timer = setTimeout(() => {
      setCards((prev) =>
        prev.map((c) => (c.id === id && c.column === 'running' ? { ...c, column: 'done' } : c)),
      );
      toast.show({ title: 'Action complete', variant: 'success' });
      executeTimersRef.current.delete(timer);
    }, 1500);
    executeTimersRef.current.add(timer);
  }

  function addManualAction() {
    if (!newTitle.trim()) return;
    setCards((prev) => [
      ...prev,
      {
        id: `manual-${Date.now()}`,
        title: newTitle.trim(),
        source: 'manual',
        provider: newProvider,
        column: 'queued',
      },
    ]);
    setNewTitle('');
    setAddDialogOpen(false);
    toast.show({ title: 'Action added', variant: 'success' });
  }

  function onDragStart(id: string) {
    setDraggedId(id);
  }

  function onDrop(col: KanbanColumn) {
    if (draggedId) {
      moveCard(draggedId, col);
      setDraggedId(null);
    }
    setDragOverCol(null);
  }

  const allDone = cards.every((c) => c.column === 'done');

  return (
    <div className="ai-root">
      <header className="ai-head">
        <span className="ai-head__eyebrow">Insights</span>
        <h2 className="ai-head__title">Action Items</h2>
        <p className="ai-head__sub">
          Drag cards between columns to track progress. Suggested items are seeded from the active
          session.
        </p>
      </header>

      <div className="ai-toolbar">
        <Button
          variant="secondary"
          size="sm"
          leadingIcon={<Plus size={14} aria-hidden />}
          onClick={() => setAddDialogOpen(true)}
        >
          Add action
        </Button>
        <Button
          variant="ghost"
          size="sm"
          leadingIcon={<Download size={14} aria-hidden />}
          disabled={cards.length === 0}
          onClick={() => exportActionItems(cards)}
        >
          Export CSV
        </Button>
        {allDone && cards.length > 0 && (
          <Badge variant="gold" size="sm">
            All done
          </Badge>
        )}
      </div>

      {/* ── Kanban board ─────────────────────────────────────── */}
      <div className="ai-kanban">
        {COLUMNS.map((col) => {
          const colCards = cards.filter((c) => c.column === col.id);
          return (
            <div
              key={col.id}
              className="ai-kanban-col"
              data-col={col.id}
              data-dragover={dragOverCol === col.id ? 'true' : undefined}
              onDragOver={(e) => {
                e.preventDefault();
                setDragOverCol(col.id);
              }}
              onDragLeave={() => setDragOverCol(null)}
              onDrop={() => onDrop(col.id)}
            >
              <div className="ai-kanban-col__header">
                <span className="ai-kanban-col__title">{col.label}</span>
                <span className="ai-kanban-col__count">{colCards.length}</span>
              </div>

              <div className="ai-kanban-col__cards">
                {colCards.length === 0 ? (
                  <div className="ai-kanban-col__empty">
                    <EmptyState
                      title="Empty"
                      description={`No ${col.label.toLowerCase()} actions.`}
                    />
                  </div>
                ) : (
                  colCards.map((card) => (
                    <div
                      key={card.id}
                      className="ai-action-card"
                      draggable
                      onDragStart={() => onDragStart(card.id)}
                      data-col={card.column}
                    >
                      <div className="ai-action-card__title">{card.title}</div>
                      <div className="ai-action-card__meta">
                        <Badge variant={SOURCE_BADGE_VARIANT[card.source]} size="sm">
                          {card.source}
                        </Badge>
                        <Tag>{card.provider}</Tag>
                      </div>
                      {card.column !== 'done' && card.column !== 'running' && (
                        <div className="ai-action-card__actions">
                          <Button variant="primary" size="sm" onClick={() => executeCard(card.id)}>
                            Execute
                          </Button>
                        </div>
                      )}
                      {card.column === 'running' && (
                        <div className="ai-action-card__running">Running…</div>
                      )}
                    </div>
                  ))
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* ── Add action dialog ─────────────────────────────────── */}
      <Dialog
        open={addDialogOpen}
        onClose={() => setAddDialogOpen(false)}
        title="Add action"
        description="Manually create an action card and queue it immediately."
        footer={
          <>
            <Button variant="ghost" onClick={() => setAddDialogOpen(false)}>
              Cancel
            </Button>
            <Button variant="primary" disabled={!newTitle.trim()} onClick={addManualAction}>
              Add
            </Button>
          </>
        }
      >
        <div className="ai-add-form">
          <Textarea
            label="Action title"
            placeholder="Describe the action to be taken…"
            rows={3}
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
          />
          <Select
            label="Provider"
            value={newProvider}
            onChange={(e) => setNewProvider(e.target.value as ActionProvider)}
            options={[
              { value: 'groq', label: 'Groq' },
              { value: 'openai', label: 'OpenAI' },
              { value: 'anthropic', label: 'Anthropic' },
              { value: 'system', label: 'System' },
            ]}
          />
        </div>
      </Dialog>
    </div>
  );
}
