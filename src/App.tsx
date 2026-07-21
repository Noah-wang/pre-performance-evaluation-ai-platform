import { Suspense, lazy } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider } from "@/hooks/useAuth";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { RoleRoute } from "@/components/RoleRoute";
import { AppLayout } from "@/components/AppLayout";
import { ErrorBoundary } from "@/components/ErrorBoundary";

const Index = lazy(() => import("./pages/Index"));
const Auth = lazy(() => import("./pages/Auth"));
const Landing = lazy(() => import("./pages/Landing"));
const Projects = lazy(() => import("./pages/Projects"));
const ProjectWorkbench = lazy(() => import("./pages/ProjectWorkbench"));
const Experts = lazy(() => import("./pages/Experts"));
const Reports = lazy(() => import("./pages/Reports"));
const WorkGroups = lazy(() => import("./pages/WorkGroups"));
const Materials = lazy(() => import("./pages/Materials"));
const KnowledgeBase = lazy(() => import("./pages/KnowledgeBase"));
const EvaluationSystem = lazy(() => import("./pages/EvaluationSystem"));
const FieldResearch = lazy(() => import("./pages/FieldResearch"));
const Meetings = lazy(() => import("./pages/Meetings"));
const Archive = lazy(() => import("./pages/Archive"));
const Packages = lazy(() => import("./pages/Packages"));
const PackageDetail = lazy(() => import("./pages/PackageDetail"));
const ExpertScoring = lazy(() => import("./pages/ExpertScoring"));
const AuditLogs = lazy(() => import("./pages/AuditLogs"));
const SecurityCenter = lazy(() => import("./pages/SecurityCenter"));
const GoalLibrary = lazy(() => import("./pages/GoalLibrary"));
const DocTemplates = lazy(() => import("./pages/DocTemplates"));
const Rectifications = lazy(() => import("./pages/Rectifications"));
const SharedReport = lazy(() => import("./pages/SharedReport"));
const NotFound = lazy(() => import("./pages/NotFound"));

const queryClient = new QueryClient();

const RouteFallback = () => (
  <div className="min-h-screen flex items-center justify-center bg-background text-sm text-muted-foreground">
    页面加载中...
  </div>
);

const Page = ({ children, name }: { children: React.ReactNode; name: string }) => (
  <ProtectedRoute>
    <AppLayout>
      <ErrorBoundary scope={name}>{children}</ErrorBoundary>
    </AppLayout>
  </ProtectedRoute>
);

const AdminPage = ({ children, name }: { children: React.ReactNode; name: string }) => (
  <RoleRoute mode="admin">
    <AppLayout>
      <ErrorBoundary scope={name}>{children}</ErrorBoundary>
    </AppLayout>
  </RoleRoute>
);

const BusinessPage = ({ children, name }: { children: React.ReactNode; name: string }) => (
  <RoleRoute mode="business">
    <AppLayout>
      <ErrorBoundary scope={name}>{children}</ErrorBoundary>
    </AppLayout>
  </RoleRoute>
);

const BusinessOrExpertPage = ({ children, name }: { children: React.ReactNode; name: string }) => (
  <RoleRoute mode="business-or-expert">
    <AppLayout>
      <ErrorBoundary scope={name}>{children}</ErrorBoundary>
    </AppLayout>
  </RoleRoute>
);

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <ErrorBoundary scope="root">
          <AuthProvider>
            <Suspense fallback={<RouteFallback />}>
              <Routes>
                <Route path="/landing" element={<ErrorBoundary scope="landing"><Landing /></ErrorBoundary>} />
                <Route path="/auth" element={<ErrorBoundary scope="auth"><Auth /></ErrorBoundary>} />
                <Route path="/s/:token" element={<ErrorBoundary scope="shared-report"><SharedReport /></ErrorBoundary>} />
                <Route path="/" element={<Page name="dashboard"><Index /></Page>} />
                <Route path="/packages" element={<BusinessPage name="packages"><Packages /></BusinessPage>} />
                <Route path="/packages/:id" element={<BusinessPage name="package-detail"><PackageDetail /></BusinessPage>} />
                <Route path="/projects" element={<BusinessPage name="projects"><Projects /></BusinessPage>} />
                <Route path="/projects/:id/workbench" element={<BusinessPage name="project-workbench"><ProjectWorkbench /></BusinessPage>} />
                <Route path="/experts" element={<BusinessPage name="experts"><Experts /></BusinessPage>} />
                <Route path="/reports" element={<BusinessPage name="reports"><Reports /></BusinessPage>} />
                <Route path="/work-groups" element={<BusinessPage name="work-groups"><WorkGroups /></BusinessPage>} />
                <Route path="/materials" element={<BusinessPage name="materials"><Materials /></BusinessPage>} />
                <Route path="/knowledge-base" element={<AdminPage name="knowledge-base"><KnowledgeBase /></AdminPage>} />
                <Route path="/evaluation-system" element={<BusinessPage name="evaluation-system"><EvaluationSystem /></BusinessPage>} />
                <Route path="/evaluations" element={<BusinessPage name="evaluations"><Meetings /></BusinessPage>} />
                <Route path="/archive" element={<BusinessPage name="archive"><Archive /></BusinessPage>} />
                <Route path="/rectifications" element={<BusinessPage name="rectifications"><Rectifications /></BusinessPage>} />
                <Route path="/goal-library" element={<BusinessPage name="goal-library"><GoalLibrary /></BusinessPage>} />
                <Route path="/security-center" element={<AdminPage name="security-center"><SecurityCenter /></AdminPage>} />
                <Route path="/audit-logs" element={<AdminPage name="audit-logs"><AuditLogs /></AdminPage>} />
                <Route path="/doc-templates" element={<AdminPage name="doc-templates"><DocTemplates /></AdminPage>} />
                <Route path="/field-research" element={<BusinessOrExpertPage name="field-research"><FieldResearch /></BusinessOrExpertPage>} />
                <Route path="/expert-scoring" element={<BusinessOrExpertPage name="expert-scoring"><ExpertScoring /></BusinessOrExpertPage>} />
                <Route path="*" element={<NotFound />} />
              </Routes>
            </Suspense>
          </AuthProvider>
        </ErrorBoundary>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
