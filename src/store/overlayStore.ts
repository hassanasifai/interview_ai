import { create } from 'zustand';

export type OverlayQuestion = {
  text: string;
  type:
    | 'factual'
    | 'pricing'
    | 'technical'
    | 'objection'
    | 'behavioral'
    | 'system-design'
    | 'coding'
    | 'hr'
    | 'other';
};

export type OverlaySuggestion = {
  question: OverlayQuestion;
  oneLiner: string;
  answerBullets: string[];
  confidence: number;
  supportSnippets: string[];
  suggestedFollowup: string;
  redFlags: string[];
};

export type CodingSolution = {
  approach: string;
  timeComplexity: string;
  spaceComplexity: string;
  pseudocode: string[];
  code: string;
  language: string;
  keyInsights: string[];
};

type OverlayState = {
  isVisible: boolean;
  isPinned: boolean;
  isClickThrough: boolean;
  currentSuggestion: OverlaySuggestion | null;
  currentSolution: CodingSolution | null;
  statusLabel: string;
  targetMonitorId: number | null;
  // Actions
  toggleVisibility: () => void;
  toggleClickThrough: () => void;
  setSuggestion: (payload: OverlaySuggestion) => void;
  setSolution: (solution: CodingSolution) => void;
  clearSolution: () => void;
  setStatus: (label: string) => void;
  clearSuggestion: () => void;
  setTargetMonitorId: (id: number | null) => void;
};

export const useOverlayStore = create<OverlayState>((set) => ({
  isVisible: true,
  isPinned: false,
  isClickThrough: false,
  currentSuggestion: null,
  currentSolution: null,
  statusLabel: 'Ready for session',
  targetMonitorId: null,

  toggleVisibility: () => set((s) => ({ isVisible: !s.isVisible })),
  toggleClickThrough: () => set((s) => ({ isClickThrough: !s.isClickThrough })),

  setSuggestion: (payload) =>
    set({ currentSuggestion: payload, statusLabel: 'Suggestion ready', isVisible: true }),

  setSolution: (solution) =>
    set({ currentSolution: solution, statusLabel: 'Solution ready', isVisible: true }),

  clearSolution: () => set({ currentSolution: null }),

  setStatus: (label) => set({ statusLabel: label }),
  clearSuggestion: () => set({ currentSuggestion: null }),
  setTargetMonitorId: (id) => set({ targetMonitorId: id }),
}));

// ── Selector hooks ───────────────────────────────────────────────────────────
// Components should prefer these over `useOverlayStore()` whole-store reads to
// avoid re-rendering on unrelated overlay state changes. Field names follow
// the underlying store (`isClickThrough`, `statusLabel`) — the hook names use
// shorter aliases for ergonomics. Other agents (2E/2F) will switch consumers
// over in their own scope.
export const useOverlayClickThrough = () => useOverlayStore((s) => s.isClickThrough);
export const useOverlayStatus = () => useOverlayStore((s) => s.statusLabel);
export const useTargetMonitorId = () => useOverlayStore((s) => s.targetMonitorId);
export const useOverlayVisible = () => useOverlayStore((s) => s.isVisible);
export const useOverlaySuggestion = () => useOverlayStore((s) => s.currentSuggestion);
export const useOverlaySolution = () => useOverlayStore((s) => s.currentSolution);
