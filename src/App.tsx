import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { useState } from 'react';
import { RootLayout } from './components/layout/RootLayout';
import { Dashboard } from './pages/Dashboard';
import { Workers } from './pages/Workers';
import { History } from './pages/History';
import { Risks } from './pages/Risks';
import { Emergency } from './pages/Emergency';
import { Matrix } from './pages/Matrix';
import { Training } from './pages/Training';
import { Normatives } from './pages/Normatives';
import { Hygiene } from './pages/Hygiene';
import { Medicine } from './pages/Medicine';
import { Ergonomics } from './pages/Ergonomics';
import { Notifications } from './pages/Notifications';
import { Settings } from './pages/Settings';
import { Help } from './pages/Help';
import { Evacuation } from './pages/Evacuation';
import { Zettelkasten } from './pages/Zettelkasten';
import { Findings } from './pages/Findings';
import { Audits } from './pages/Audits';
import { Projects } from './pages/Projects';
import { Documents } from './pages/Documents';
import { Calendar } from './pages/Calendar';
import { EPP } from './pages/EPP';
import { PTSGenerator } from './pages/PTSGenerator';
import { BioAnalysis } from './pages/BioAnalysis';
import { DigitalTwin } from './pages/DigitalTwin';
import { NormativeDetail } from './pages/NormativeDetail';
import { Assets } from './pages/Assets';
import { PublicNodeView } from './pages/PublicNodeView';
import { Profile } from './pages/Profile';
import { Login } from './pages/Login';
import { Splash } from './pages/Splash';
import { AIHub } from './pages/AIHub';
import { Attendance } from './pages/Attendance';
import { GuardianVoiceAssistant } from './components/ai/GuardianVoiceAssistant';
import { FirebaseProvider, useFirebase } from './contexts/FirebaseContext';
import { ProjectProvider } from './contexts/ProjectContext';
import { UniversalKnowledgeProvider } from './contexts/UniversalKnowledgeContext';
import { ErrorBoundary } from './components/shared/ErrorBoundary';

function AppRoutes() {
  const { user, loading } = useFirebase();
  const [hasEntered, setHasEntered] = useState(false);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-zinc-50 dark:bg-zinc-950">
        <div className="flex flex-col items-center">
          <div className="w-12 h-12 border-4 border-emerald-500/20 border-t-emerald-500 rounded-full animate-spin mb-4" />
          <span className="text-[10px] font-bold uppercase tracking-widest text-zinc-400">Calibrando Conciencia...</span>
        </div>
      </div>
    );
  }

  if (!hasEntered) {
    return <Splash onEnter={() => setHasEntered(true)} />;
  }

  return (
    <UniversalKnowledgeProvider>
      <ProjectProvider>
        <Routes>
          <Route path="/login" element={!user ? <Login /> : <Navigate to="/" />} />
          <Route path="/public/node/:nodeId" element={<PublicNodeView />} />
          <Route path="/" element={<RootLayout />}>
            <Route index element={<Dashboard />} />
            <Route path="evacuation" element={<Evacuation />} />
            <Route path="emergency" element={<Emergency />} />
            <Route path="matrix" element={<Matrix />} />
            <Route path="risks" element={<Risks />} />
            <Route path="training" element={<Training />} />
            <Route path="workers" element={<Workers />} />
            <Route path="epp" element={<EPP />} />
            <Route path="pts" element={<PTSGenerator />} />
            <Route path="bio-analysis" element={<BioAnalysis />} />
            <Route path="digital-twin" element={<DigitalTwin />} />
            <Route path="assets" element={<Assets />} />
            <Route path="history" element={<History />} />
            <Route path="normatives" element={<Normatives />} />
            <Route path="normatives/:id" element={<NormativeDetail />} />
            <Route path="hygiene" element={<Hygiene />} />
            <Route path="medicine" element={<Medicine />} />
            <Route path="ergonomics" element={<Ergonomics />} />
            <Route path="notifications" element={<Notifications />} />
            <Route path="settings" element={<Settings />} />
            <Route path="help" element={<Help />} />
            <Route path="zettelkasten" element={<Zettelkasten />} />
            <Route path="findings" element={<Findings />} />
            <Route path="audits" element={<Audits />} />
            <Route path="attendance" element={<Attendance />} />
            <Route path="projects" element={<Projects />} />
            <Route path="documents" element={<Documents />} />
            <Route path="calendar" element={<Calendar />} />
            <Route path="ai-hub" element={<AIHub />} />
            <Route path="profile" element={user ? <Profile /> : <Navigate to="/login" />} />
          </Route>
        </Routes>
      </ProjectProvider>
    </UniversalKnowledgeProvider>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <FirebaseProvider>
        <BrowserRouter>
          <AppRoutes />
          <GuardianVoiceAssistant />
        </BrowserRouter>
      </FirebaseProvider>
    </ErrorBoundary>
  );
}
