import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { lazy, Suspense, type ReactNode } from 'react';
import { hasPermission, type Permission } from '@ghlearn/shared';
import { useAuth, hadSession } from './lib/auth';
import { Layout, navFor } from './components/Layout';
import { Spinner, Alert } from './components/ui';
import { ChangePasswordPage, LoginPage, RegisterPage, LegalPage, ForgotPasswordPage, ResetPasswordPage } from './pages/Auth';
import { usePlatform } from './lib/platform';

/** Route-level code splitting: each page group is its own chunk. */
const OnboardingPage = lazy(() => import('./pages/Onboarding').then((m) => ({ default: m.OnboardingPage })));
const LearnHome = lazy(() => import('./pages/Learn').then((m) => ({ default: m.LearnHome })));
const SubjectPage = lazy(() => import('./pages/Learn').then((m) => ({ default: m.SubjectPage })));
const ResourcePage = lazy(() => import('./pages/Learn').then((m) => ({ default: m.ResourcePage })));
const TeachHome = lazy(() => import('./pages/Teach').then((m) => ({ default: m.TeachHome })));
const ClassPage = lazy(() => import('./pages/Teach').then((m) => ({ default: m.ClassPage })));
const ClassStudentPage = lazy(() => import('./pages/Teach').then((m) => ({ default: m.ClassStudentPage })));
const LearningAnalyticsPage = lazy(() => import('./admin/insights').then((m) => ({ default: m.LearningAnalyticsPage })));
const AiUsagePage = lazy(() => import('./admin/insights').then((m) => ({ default: m.AiUsagePage })));
const NotificationsAdminPage = lazy(() => import('./admin/insights').then((m) => ({ default: m.NotificationsAdminPage })));
const NotificationsPage = lazy(() => import('./pages/Analytics').then((m) => ({ default: m.NotificationsPage })));
const LessonsPage = lazy(() => import('./pages/Lessons').then((m) => ({ default: m.LessonsPage })));
const LessonEditorPage = lazy(() => import('./pages/Lessons').then((m) => ({ default: m.LessonEditorPage })));
const TutorPage = lazy(() => import('./pages/Tutor').then((m) => ({ default: m.TutorPage })));
const PracticeHome = lazy(() => import('./pages/Practice').then((m) => ({ default: m.PracticeHome })));
const AttemptPage = lazy(() => import('./pages/Practice').then((m) => ({ default: m.AttemptPage })));
const GamesHome = lazy(() => import('./pages/Games').then((m) => ({ default: m.GamesHome })));
const GamePlayPage = lazy(() => import('./pages/Games').then((m) => ({ default: m.GamePlayPage })));
const ProgressPage = lazy(() => import('./pages/Progress').then((m) => ({ default: m.ProgressPage })));
const QuestionBankPage = lazy(() => import('./pages/QuestionBank').then((m) => ({ default: m.QuestionBankPage })));
const QuestionDetailPage = lazy(() => import('./pages/QuestionBank').then((m) => ({ default: m.QuestionDetailPage })));
const GameDesignsPage = lazy(() => import('./pages/GameDesigns').then((m) => ({ default: m.GameDesignsPage })));
const GameDesignPage = lazy(() => import('./pages/GameDesigns').then((m) => ({ default: m.GameDesignPage })));
const TeachAssessPage = lazy(() => import('./pages/TeachAssess').then((m) => ({ default: m.TeachAssessPage })));
const AssessmentResultsPage = lazy(() => import('./pages/TeachAssess').then((m) => ({ default: m.AssessmentResultsPage })));
const MarkingPage = lazy(() => import('./pages/TeachAssess').then((m) => ({ default: m.MarkingPage })));
const AdminUsersPage = lazy(() => import('./admin/users').then((m) => ({ default: m.AdminUsersPage })));
const UserDetailPage = lazy(() => import('./admin/users').then((m) => ({ default: m.UserDetailPage })));
const SchoolsPage = lazy(() => import('./admin/schools').then((m) => ({ default: m.SchoolsPage })));
const SchoolDetailPage = lazy(() => import('./admin/schools').then((m) => ({ default: m.SchoolDetailPage })));
const StructurePage = lazy(() => import('./admin/structure').then((m) => ({ default: m.StructurePage })));
const ClassesPage = lazy(() => import('./admin/classes').then((m) => ({ default: m.ClassesPage })));
const ClassDetailPage = lazy(() => import('./admin/classes').then((m) => ({ default: m.ClassDetailPage })));
const ImportPage = lazy(() => import('./admin/classes').then((m) => ({ default: m.ImportPage })));
const AdminLayout = lazy(() => import('./admin/AdminLayout').then((m) => ({ default: m.AdminLayout })));
const OverviewPage = lazy(() => import('./admin/pages').then((m) => ({ default: m.OverviewPage })));
const SystemSettingsPage = lazy(() => import('./admin/settings').then((m) => ({ default: m.SystemSettingsPage })));
const ProcessingMonitorPage = lazy(() => import('./admin/jobs').then((m) => ({ default: m.ProcessingMonitorPage })));
const JobInspectorPage = lazy(() => import('./admin/jobs').then((m) => ({ default: m.JobInspectorPage })));
const AccountPage = lazy(() => import('./admin/pages').then((m) => ({ default: m.AccountPage })));
const SearchPage = lazy(() => import('./admin/pages').then((m) => ({ default: m.SearchPage })));
const ReviewQueuePage = lazy(() => import('./admin/pages').then((m) => ({ default: m.ReviewQueuePage })));
const AuditLogPage = lazy(() => import('./admin/pages').then((m) => ({ default: m.AuditLogPage })));
const CurriculumPage = lazy(() => import('./admin/curriculum').then((m) => ({ default: m.CurriculumPage })));
const CurriculumVersionPage = lazy(() => import('./admin/curriculum').then((m) => ({ default: m.CurriculumVersionPage })));
const DocumentsPage = lazy(() => import('./pages/Documents').then((m) => ({ default: m.DocumentsPage })));
const DocumentDetailPage = lazy(() => import('./pages/Documents').then((m) => ({ default: m.DocumentDetailPage })));

/** Public website (landing + public pages): its own chunks, loaded only on those routes. */
const LandingPage = lazy(() => import('./landing/LandingPage'));
const P = (k: 'SubjectsPage' | 'PublicSubjectPage' | 'PreviewLessonPage' | 'TeachersPage' | 'SchoolsPage' | 'HelpPage' | 'ContactPage' | 'AccessibilityPage') => lazy(() => import('./landing/pages').then((m) => ({ default: m[k] as any })));
const PublicSubjects = P('SubjectsPage'), PublicSubject = P('PublicSubjectPage'), PreviewLesson = P('PreviewLessonPage'), TeachersInfo = P('TeachersPage'), SchoolsInfo = P('SchoolsPage'), Help = P('HelpPage'), Contact = P('ContactPage'), Accessibility = P('AccessibilityPage');
const WebsitePage = lazy(() => import('./admin/website').then((m) => ({ default: m.WebsitePage })));
const MeetingsPage = lazy(() => import('./pages/Meetings').then((m) => ({ default: m.MeetingsPage })));
const MyAccountPage = lazy(() => import('./pages/Account').then((m) => ({ default: m.MyAccountPage })));
const ProfilePage = lazy(() => import('./pages/Profile').then((m) => ({ default: m.ProfilePage })));
const SavedPage = lazy(() => import('./pages/Saved').then((m) => ({ default: m.SavedPage })));
const SavedLessonPage = lazy(() => import('./pages/Saved').then((m) => ({ default: m.SavedLessonPage })));

function Guard({ children, perm, any }: { children: ReactNode; perm?: Permission; any?: Permission[] }) {
  const { user, loading } = useAuth(); const loc = useLocation();
  if (loading) return <Spinner />;
  if (!user) return <Navigate to="/login" state={{ from: loc }} replace />;
  if (user.mustChangePassword) return <Navigate to="/change-password" replace />;
  if (!user.onboarded && loc.pathname !== '/onboarding') return <Navigate to="/onboarding" replace />;
  if ((perm && !hasPermission(user.roles, perm)) || (any && !any.some((p) => hasPermission(user.roles, p)))) return <Alert>You do not have access to this page.</Alert>;
  return <>{children}</>;
}
/** Users without admin:access get the normal app shell with a denial (URL manipulation never shows the admin shell). */
/** Only reachable while a password change is pending; otherwise it sends the user home. */
function PasswordGate() {
  const { user, loading } = useAuth();
  if (loading) return <Spinner />; if (!user) return <Navigate to="/login" replace />;
  return user.mustChangePassword ? <ChangePasswordPage /> : <Navigate to="/" replace />;
}
function AdminGate() {
  const { user } = useAuth();
  return hasPermission(user!.roles, 'admin:access') ? <AdminLayout /> : <Layout><Alert>You do not have access to this page.</Alert></Layout>;
}
function StudentOnly({ children }: { children: ReactNode }) { const { user } = useAuth(); return user!.roles.includes('student') ? <>{children}</> : <Alert>You do not have access to this page.</Alert>; }
/** "/": the landing page for visitors; signed-in users go straight to their dashboard (waits for /me only if a session was seen here before). */
function Root() {
  const { user, loading } = useAuth();
  if (loading && hadSession()) return <Spinner />;
  if (user) return <Guard><Layout><Home /></Layout></Guard>;
  return <LandingPage />;
}
function Home() { const { user } = useAuth(); const p = usePlatform(); const first = hasPermission(user!.roles, 'admin:access') ? '/admin' : navFor(user!.roles, p.features)[0].to; return first === '/' ? <Alert tone="info">Welcome. Your tools will appear here.</Alert> : <Navigate to={first} replace />; }
export function App() {
  return <Suspense fallback={<Spinner />}><Routes>
    <Route index element={<Root />} />
    <Route path="/welcome" element={<LandingPage />} />
    <Route path="/subjects" element={<PublicSubjects />} />
    <Route path="/subjects/:id" element={<PublicSubject />} />
    <Route path="/preview/:id" element={<PreviewLesson />} />
    <Route path="/teachers" element={<TeachersInfo />} />
    <Route path="/schools" element={<SchoolsInfo />} />
    <Route path="/help" element={<Help />} />
    <Route path="/contact" element={<Contact />} />
    <Route path="/accessibility" element={<Accessibility />} />
    <Route path="/login" element={<LoginPage />} />
    <Route path="/register" element={<RegisterPage />} />
    <Route path="/forgot-password" element={<ForgotPasswordPage />} />
    <Route path="/reset-password" element={<ResetPasswordPage />} />
    <Route path="/terms" element={<LegalPage kind="terms" />} />
    <Route path="/privacy" element={<LegalPage kind="privacy" />} />
    <Route path="/saved" element={<SavedPage />} />
    <Route path="/saved/:id" element={<SavedLessonPage />} />
    <Route path="/change-password" element={<PasswordGate />} />
    <Route path="/onboarding" element={<Guard><OnboardingPage /></Guard>} />
    <Route element={<Guard><Layout /></Guard>}>
      <Route path="learn" element={<Guard perm="learn:access"><LearnHome /></Guard>} />
      <Route path="learn/:subjectId" element={<Guard perm="learn:access"><SubjectPage /></Guard>} />
      <Route path="learn/:subjectId/r/:resourceId" element={<Guard perm="learn:access"><ResourcePage /></Guard>} />
      <Route path="learn/:subjectId/tutor" element={<Guard perm="tutor:use"><TutorPage /></Guard>} />
      <Route path="learn/:subjectId/practice" element={<Guard perm="learn:access"><PracticeHome /></Guard>} />
      <Route path="learn/:subjectId/practice/:attemptId" element={<Guard perm="learn:access"><AttemptPage /></Guard>} />
      <Route path="learn/:subjectId/games" element={<Guard perm="learn:access"><GamesHome /></Guard>} />
      <Route path="learn/:subjectId/games/:sessionId" element={<Guard perm="learn:access"><GamePlayPage /></Guard>} />
      <Route path="progress" element={<Guard perm="progress:view_own"><ProgressPage /></Guard>} />
      <Route path="teach/assess" element={<Guard perm="activity:assign"><TeachAssessPage /></Guard>} />
      <Route path="teach/assessments/:id" element={<Guard perm="activity:assign"><AssessmentResultsPage /></Guard>} />
      <Route path="teach/marking/:attemptId" element={<Guard perm="activity:assign"><MarkingPage /></Guard>} />
      <Route path="teach" element={<Guard perm="class:manage"><TeachHome /></Guard>} />
      <Route path="teach/classes/:id" element={<Guard perm="class:manage"><ClassPage /></Guard>} />
      <Route path="teach/classes/:id/students/:userId" element={<Guard perm="class:manage"><ClassStudentPage /></Guard>} />
      <Route path="notifications" element={<NotificationsPage />} />
      <Route path="account" element={<MyAccountPage />} />
      <Route path="meetings" element={<Guard any={['meetings:request', 'meetings:host']}><MeetingsPage /></Guard>} />
      <Route path="profile" element={<Guard perm="learn:access"><StudentOnly><ProfilePage /></StudentOnly></Guard>} />
      <Route path="*" element={<Alert>Page not found.</Alert>} />
    </Route>
    {/* Admin panel (spec §3). Each route re-checks its permission; the server enforces the same rules. */}
    <Route path="admin" element={<Guard><AdminGate /></Guard>}>
      <Route index element={<OverviewPage />} />
      <Route path="schools" element={<Guard any={['school:create', 'school:manage']}><SchoolsPage /></Guard>} />
      <Route path="schools/:id" element={<Guard any={['school:create', 'school:manage']}><SchoolDetailPage /></Guard>} />
      <Route path="users" element={<Guard perm="users:manage"><AdminUsersPage /></Guard>} />
      <Route path="users/:id" element={<Guard perm="users:manage"><UserDetailPage /></Guard>} />
      <Route path="classes" element={<Guard perm="users:manage"><Guard perm="class:manage"><ClassesPage /></Guard></Guard>} />
      <Route path="classes/import" element={<Guard perm="users:manage"><Guard perm="class:manage"><ImportPage /></Guard></Guard>} />
      <Route path="classes/:id" element={<Guard perm="users:manage"><Guard perm="class:manage"><ClassDetailPage /></Guard></Guard>} />
      <Route path="structure" element={<Guard any={['config:manage', 'curriculum:manage']}><StructurePage /></Guard>} />
      <Route path="config" element={<Navigate to="/admin/structure" replace />} />
      <Route path="curriculum" element={<Guard any={['curriculum:manage']}><CurriculumPage /></Guard>} />
      <Route path="curriculum/:id" element={<Guard any={['curriculum:manage']}><CurriculumVersionPage /></Guard>} />
      <Route path="documents" element={<Guard any={['documents:upload', 'documents:map', 'content:review']}><DocumentsPage /></Guard>} />
      <Route path="documents/:id" element={<Guard any={['documents:upload', 'documents:map', 'content:review']}><DocumentDetailPage /></Guard>} />
      <Route path="lessons" element={<Guard any={['content:edit', 'content:review']}><LessonsPage /></Guard>} />
      <Route path="lessons/:id" element={<Guard any={['content:edit', 'content:review']}><LessonEditorPage /></Guard>} />
      <Route path="review" element={<Guard perm="content:review"><ReviewQueuePage /></Guard>} />
      <Route path="questions" element={<Guard any={['content:edit', 'content:review']}><QuestionBankPage /></Guard>} />
      <Route path="questions/:id" element={<Guard any={['content:edit', 'content:review']}><QuestionDetailPage /></Guard>} />
      <Route path="games" element={<Guard any={['content:edit', 'content:review']}><GameDesignsPage /></Guard>} />
      <Route path="games/:id" element={<Guard any={['content:edit', 'content:review']}><GameDesignPage /></Guard>} />
      <Route path="analytics" element={<Guard perm="analytics:view"><LearningAnalyticsPage /></Guard>} />
      <Route path="ai-usage" element={<Guard any={['analytics:view', 'system:health']}><AiUsagePage /></Guard>} />
      <Route path="audit" element={<Guard perm="audit:view"><AuditLogPage /></Guard>} />
      <Route path="system" element={<Guard perm="system:health"><SystemSettingsPage /></Guard>} />
      <Route path="processing" element={<Guard any={['system:health', 'curriculum:manage']}><ProcessingMonitorPage /></Guard>} />
      <Route path="processing/:id" element={<Guard any={['system:health', 'curriculum:manage']}><JobInspectorPage /></Guard>} />
      <Route path="account" element={<AccountPage />} />
      <Route path="search" element={<SearchPage />} />
      <Route path="notifications" element={<NotificationsAdminPage />} />
      <Route path="website" element={<Guard perm="platform:manage"><WebsitePage /></Guard>} />
      <Route path="*" element={<Alert>Page not found.</Alert>} />
    </Route>
  </Routes></Suspense>;
}
