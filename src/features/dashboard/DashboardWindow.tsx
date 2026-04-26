import {
  BookOpen,
  BrainCircuit,
  Briefcase,
  ChevronLeft,
  ChevronRight,
  Code2,
  FileText,
  ListTodo,
  Mic2,
  Monitor,
  PanelsTopLeft,
  PlugZap,
  Search,
  Settings2,
  ShieldCheck,
  Sparkles,
  Square,
  TerminalSquare,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { AppRoutes } from '../../app/routes';
import { logger } from '../../lib/logger';
import { MissingApiKeyError } from '../../lib/providers/contracts';
import { getRuntimeConfigHealth } from '../../lib/runtime/appConfig';
import { useSessionStore } from '../../store/sessionStore';
import {
  Button,
  CommandPalette,
  IconButton,
  StatusDot,
  Tooltip,
  useToast,
  type CommandItem,
  type StatusDotStatus,
} from '../../components/ui';
import { cn } from '../../lib/cn';
import './dashboardShell.css';

type NavEntry = {
  to: string;
  label: string;
  icon: LucideIcon;
  keywords?: string[];
};

type NavGroupSpec = {
  id: string;
  label: string;
  items: NavEntry[];
};

const NAV_GROUPS: NavGroupSpec[] = [
  {
    id: 'live',
    label: 'Live',
    items: [
      { to: '/sessions', label: 'Sessions', icon: Sparkles, keywords: ['history', 'past'] },
      { to: '/mock-interview', label: 'Mock Interview', icon: Mic2, keywords: ['practice'] },
      { to: '/coding', label: 'Coding Mode', icon: Code2, keywords: ['leetcode', 'algo'] },
    ],
  },
  {
    id: 'prep',
    label: 'Prep',
    items: [
      { to: '/knowledge', label: 'Knowledge', icon: BookOpen, keywords: ['rag', 'docs'] },
      { to: '/job-description', label: 'Job Description', icon: Briefcase, keywords: ['jd'] },
      { to: '/resume-builder', label: 'Resume Builder', icon: FileText, keywords: ['cv'] },
    ],
  },
  {
    id: 'insights',
    label: 'Insights',
    items: [
      { to: '/actions', label: 'Action Items', icon: ListTodo, keywords: ['todos', 'followups'] },
    ],
  },
  {
    id: 'system',
    label: 'System',
    items: [
      { to: '/integrations', label: 'Integrations', icon: PlugZap, keywords: ['crm', 'slack'] },
      { to: '/ops', label: 'Operations', icon: TerminalSquare, keywords: ['telemetry', 'logs'] },
      { to: '/share-guard', label: 'Share Guard', icon: ShieldCheck, keywords: ['screen share'] },
      { to: '/settings', label: 'Settings', icon: Settings2, keywords: ['prefs', 'account'] },
    ],
  },
];

const ROUTE_TITLES: Record<string, { title: string; crumb: string }> = {
  '/': { title: 'Home', crumb: 'Dashboard' },
  '/onboarding': { title: 'Welcome', crumb: 'Setup · Onboarding' },
  '/sessions': { title: 'Sessions', crumb: 'Live · Session history' },
  '/mock-interview': { title: 'Mock Interview', crumb: 'Live · Practice runs' },
  '/knowledge': { title: 'Knowledge Base', crumb: 'Prep · RAG sources' },
  '/job-description': { title: 'Job Description', crumb: 'Prep · Role targeting' },
  '/resume-builder': { title: 'Resume Builder', crumb: 'Prep · Your profile' },
  '/coding': { title: 'Coding Mode', crumb: 'Live · Engineering copilot' },
  '/integrations': { title: 'Integrations', crumb: 'System · Connected services' },
  '/ops': { title: 'Operations', crumb: 'System · Observability' },
  '/share-guard': { title: 'Share Guard', crumb: 'System · Meeting safety' },
  '/actions': { title: 'Action Items', crumb: 'Insights · Follow-ups' },
  '/settings': { title: 'Settings', crumb: 'System · Preferences' },
};

function resolveRouteMeta(pathname: string): { title: string; crumb: string } {
  if (ROUTE_TITLES[pathname]) return ROUTE_TITLES[pathname];
  if (pathname.startsWith('/sessions/')) {
    return { title: 'Session Detail', crumb: 'Live · Session transcript' };
  }
  return { title: 'MeetingMind', crumb: 'AI Copilot' };
}

function sessionModeToStatus(mode: string, isGenerating: boolean): StatusDotStatus {
  if (mode === 'running') return isGenerating ? 'info' : 'ok';
  if (mode === 'paused') return 'warn';
  return 'neutral';
}

function sessionModeLabel(mode: string, isGenerating: boolean): string {
  if (mode === 'running') return isGenerating ? 'Generating' : 'Listening';
  if (mode === 'paused') return 'Paused';
  return 'Idle';
}

const isTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

async function tryOpenTauriWindow(label: string): Promise<boolean> {
  if (!isTauri) return false;
  try {
    const mod = await import('@tauri-apps/api/core');
    await mod.invoke('toggle_overlay', { label, visible: true });
    return true;
  } catch (err) {
    logger.warn('dashboard', 'tryOpenTauriWindow failed', { err: String(err), label });
    return false;
  }
}

export function DashboardWindow() {
  const configHealth = getRuntimeConfigHealth();
  const location = useLocation();
  const toast = useToast();

  const sessionMode = useSessionStore((s) => s.mode);
  const isGenerating = useSessionStore((s) => s.isGenerating);
  const startLiveCaptureSession = useSessionStore((s) => s.startLiveCaptureSession);
  const endSession = useSessionStore((s) => s.endSession);
  const toggleShortcutWithShareGuard = useSessionStore((s) => s.toggleShortcutWithShareGuard);

  const [collapsed, setCollapsed] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);

  const routeMeta = useMemo(() => resolveRouteMeta(location.pathname), [location.pathname]);

  // Tray navigation listener (preserved from prior implementation)
  useEffect(() => {
    let unlisten: (() => void) | null = null;

    async function listenForTrayNavigation() {
      if (!('__TAURI_INTERNALS__' in window)) return;
      const { listen } = await import('@tauri-apps/api/event');
      unlisten = await listen('open_share_guard_dashboard', () => {
        window.location.hash = '#/share-guard';
      });
    }

    listenForTrayNavigation().catch((err) => {
      logger.warn('dashboard', 'tray navigation listener failed', { err: String(err) });
    });
    return () => {
      unlisten?.();
    };
  }, []);

  // Ctrl+K / Cmd+K opens command palette
  useEffect(() => {
    function handler(e: KeyboardEvent) {
      const isK = e.key === 'k' || e.key === 'K';
      if (isK && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        setPaletteOpen((prev) => !prev);
      }
    }
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  const handleOpenOverlay = useCallback(async () => {
    const ok = await tryOpenTauriWindow('capture-excluded-overlay');
    if (ok) toast.show({ title: 'Overlay opened', variant: 'success' });
  }, [toast]);

  const handleOpenCompanion = useCallback(async () => {
    const ok = await tryOpenTauriWindow('companion');
    if (ok) toast.show({ title: 'Companion opened', variant: 'success' });
  }, [toast]);

  const paletteItems = useMemo<CommandItem[]>(() => {
    const navCommands: CommandItem[] = NAV_GROUPS.flatMap((group) =>
      group.items.map(
        (item): CommandItem => ({
          id: `nav-${item.to}`,
          label: item.label,
          group: group.label,
          ...(item.keywords ? { keywords: item.keywords } : {}),
          icon: <item.icon size={14} />,
          onSelect: () => {
            window.location.hash = '#' + item.to;
          },
        }),
      ),
    );

    const actions: CommandItem[] = [
      {
        id: 'action-start-session',
        label: 'Start session',
        group: 'Actions',
        keywords: ['begin', 'record'],
        icon: <Sparkles size={14} />,
        onSelect: () => {
          useSessionStore
            .getState()
            .startLiveCaptureSession(true)
            .catch((err) => {
              if (err instanceof MissingApiKeyError) {
                // toast already fires from §5 listener; nothing to do
                return;
              }
              logger.warn('dashboard', 'start live capture failed', { err: String(err) });
            });
          toast.show({ title: 'Session starting', variant: 'info' });
        },
      },
      {
        id: 'action-stop-session',
        label: 'Stop session',
        group: 'Actions',
        keywords: ['end', 'finish'],
        icon: <Square size={14} />,
        onSelect: () => {
          endSession();
          toast.show({ title: 'Session ended', variant: 'info' });
        },
      },
      {
        id: 'action-open-overlay',
        label: 'Open overlay window',
        group: 'Actions',
        keywords: ['copilot', 'hud'],
        icon: <PanelsTopLeft size={14} />,
        onSelect: () => {
          handleOpenOverlay().catch((err) => {
            logger.warn('dashboard', 'handleOpenOverlay failed', { err: String(err) });
          });
        },
      },
      {
        id: 'action-toggle-click-through',
        label: 'Toggle click-through',
        group: 'Actions',
        keywords: ['passthrough', 'clicks'],
        icon: <Monitor size={14} />,
        onSelect: () => {
          toggleShortcutWithShareGuard().catch((err) => {
            logger.warn('dashboard', 'toggleShortcutWithShareGuard failed', { err: String(err) });
          });
        },
      },
      {
        id: 'action-open-share-guard',
        label: 'Open Share Guard',
        group: 'Actions',
        keywords: ['safety', 'capture'],
        icon: <ShieldCheck size={14} />,
        onSelect: () => {
          window.location.hash = '#/share-guard';
        },
      },
    ];

    return [...navCommands, ...actions];
  }, [endSession, toggleShortcutWithShareGuard, handleOpenOverlay, toast]);

  const sessionIsRunning = sessionMode === 'running' || sessionMode === 'paused';
  const statusKind = sessionModeToStatus(sessionMode, isGenerating);
  const statusText = sessionModeLabel(sessionMode, isGenerating);

  return (
    <div
      className={cn('ds-shell', collapsed && 'ds-shell--collapsed')}
      data-testid="dashboard-window"
    >
      <div className="ds-noise-overlay" aria-hidden />

      <aside className="ds-sidebar" aria-label="Primary navigation">
        <div className="ds-brand">
          <div className="ds-brand__badge" aria-hidden>
            <BrainCircuit size={20} />
          </div>
          <div className="ds-brand__text">
            <span className="ds-brand__name">MeetingMind</span>
            <span className="ds-brand__sub">AI Copilot</span>
          </div>
        </div>

        <nav className="ds-nav" aria-label="App sections">
          {NAV_GROUPS.map((group) => (
            <div className="ds-nav-group" key={group.id}>
              <span className="ds-nav-group__label">{group.label}</span>
              {group.items.map((item) => (
                <NavItem key={item.to} entry={item} collapsed={collapsed} />
              ))}
            </div>
          ))}
        </nav>

        <div className="ds-session-card" role="status" aria-live="polite">
          <div className="ds-session-card__head">
            <StatusDot status={statusKind} />
            <div className="ds-session-card__title">Session</div>
          </div>
          <div className="ds-session-card__body">
            <div className="ds-session-card__mode">{statusText}</div>
            {sessionIsRunning ? (
              <Button
                variant="secondary"
                size="sm"
                onClick={() => {
                  endSession();
                  toast.show({ title: 'Session ended', variant: 'info' });
                }}
              >
                Stop session
              </Button>
            ) : (
              <Button
                variant="primary"
                size="sm"
                onClick={() => {
                  startLiveCaptureSession(true).catch((err) => {
                    if (err instanceof MissingApiKeyError) {
                      // toast already fires from §5 listener; nothing to do
                      return;
                    }
                    logger.warn('dashboard', 'start live capture failed', { err: String(err) });
                  });
                  toast.show({ title: 'Session starting', variant: 'info' });
                }}
              >
                Start session
              </Button>
            )}
          </div>
        </div>

        <div className="ds-sidebar-foot">
          <Tooltip content={collapsed ? 'Expand sidebar' : 'Collapse sidebar'} side="right">
            <button
              type="button"
              className="ds-collapse-btn"
              aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
              aria-pressed={collapsed}
              onClick={() => setCollapsed((v) => !v)}
            >
              {collapsed ? <ChevronRight size={14} /> : <ChevronLeft size={14} />}
            </button>
          </Tooltip>
        </div>
      </aside>

      <div className="ds-main-col">
        <header className="ds-header">
          <div className="ds-header-title">
            <div className="ds-header-title__crumb">{routeMeta.crumb}</div>
            <div className="ds-header-title__h">{routeMeta.title}</div>
          </div>

          <button
            type="button"
            className="ds-header-search"
            onClick={() => setPaletteOpen(true)}
            aria-label="Open command palette"
          >
            <Search size={14} />
            <span className="ds-header-search__placeholder">Jump to…</span>
            <span className="ds-header-search__kbd">Ctrl K</span>
          </button>

          <div className="ds-header-actions">
            {isTauri && (
              <>
                <Tooltip content="Open overlay window" side="bottom">
                  <IconButton
                    aria-label="Open overlay"
                    variant="ghost"
                    onClick={() => void handleOpenOverlay()}
                  >
                    <PanelsTopLeft size={16} />
                  </IconButton>
                </Tooltip>
                <Tooltip content="Open companion window" side="bottom">
                  <IconButton
                    aria-label="Open companion"
                    variant="ghost"
                    onClick={() => void handleOpenCompanion()}
                  >
                    <Monitor size={16} />
                  </IconButton>
                </Tooltip>
              </>
            )}
            <StatusDot
              status={configHealth.ok ? 'ok' : 'danger'}
              label={configHealth.ok ? 'Config healthy' : 'Config issue'}
            />
          </div>
        </header>

        {!configHealth.ok ? (
          <div className="ds-header-alert" role="alert">
            <strong>Runtime config validation failed</strong>
            <span>{configHealth.errors.join(' · ')}</span>
          </div>
        ) : null}

        <main className="ds-main">
          <div className="ds-main__inner">
            <AppRoutes />
          </div>
        </main>
      </div>

      <CommandPalette
        open={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        items={paletteItems}
        placeholder="Jump to a section or run a command…"
      />
    </div>
  );
}

function NavItem({ entry, collapsed }: { entry: NavEntry; collapsed: boolean }): ReactNode {
  const Icon = entry.icon;
  const link = (
    <NavLink
      to={entry.to}
      className={({ isActive }) => cn('ds-nav-link', isActive && 'ds-nav-link--active')}
    >
      <span className="ds-nav-icon" aria-hidden>
        <Icon size={18} />
      </span>
      <span className="ds-nav-link__label">{entry.label}</span>
      <ChevronRight size={14} className="ds-nav-link__chev" aria-hidden />
    </NavLink>
  );

  if (collapsed) {
    return (
      <Tooltip content={entry.label} side="right">
        {link}
      </Tooltip>
    );
  }

  return link;
}
