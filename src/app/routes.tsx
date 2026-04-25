import { Navigate, Route, Routes } from 'react-router-dom';
import { ActionItemsPage } from '../features/dashboard/ActionItemsPage';
import { CodingAssistPage } from '../features/dashboard/CodingAssistPage';
import { IntegrationsPage } from '../features/dashboard/IntegrationsPage';
import { JobDescriptionPage } from '../features/dashboard/JobDescriptionPage';
import { KnowledgeBasePage } from '../features/dashboard/KnowledgeBasePage';
import { MockInterviewPage } from '../features/dashboard/MockInterviewPage';
import { OnboardingPage } from '../features/dashboard/OnboardingPage';
import { OperationsPage } from '../features/dashboard/OperationsPage';
import { ResumeBuilderPage } from '../features/dashboard/ResumeBuilderPage';
import { SessionDetailPage } from '../features/dashboard/SessionDetailPage';
import { SessionHistoryPage } from '../features/dashboard/SessionHistoryPage';
import { SettingsPage } from '../features/dashboard/SettingsPage';
import { ShareGuardPage } from '../features/dashboard/ShareGuardPage';
import { CaptureExcludedOverlay } from '../features/overlay/CaptureExcludedOverlay';
import { useSettingsStore } from '../store/settingsStore';

export function AppRoutes() {
  const { profile } = useSettingsStore();
  const isConfigured =
    profile.userName.trim().length > 0 &&
    profile.userRole.trim().length > 0 &&
    profile.companyName.trim().length > 0;

  return (
    <Routes>
      <Route
        path="/"
        element={<Navigate to={isConfigured ? '/sessions' : '/onboarding'} replace />}
      />
      <Route path="/onboarding" element={<OnboardingPage />} />
      <Route path="/sessions" element={<SessionHistoryPage />} />
      <Route path="/sessions/:sessionId" element={<SessionDetailPage />} />
      <Route path="/mock-interview" element={<MockInterviewPage />} />
      <Route path="/knowledge" element={<KnowledgeBasePage />} />
      <Route path="/job-description" element={<JobDescriptionPage />} />
      <Route path="/resume-builder" element={<ResumeBuilderPage />} />
      <Route path="/coding" element={<CodingAssistPage />} />
      <Route path="/integrations" element={<IntegrationsPage />} />
      <Route path="/ops" element={<OperationsPage />} />
      <Route path="/share-guard" element={<ShareGuardPage />} />
      <Route path="/overlay" element={<CaptureExcludedOverlay />} />
      <Route path="/actions" element={<ActionItemsPage />} />
      <Route path="/settings" element={<SettingsPage />} />
    </Routes>
  );
}
