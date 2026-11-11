import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { lazy } from "react";

import AppLayout from "./components/AppLayout";
import Login from "./pages/Login";
const Dashboard = lazy(() => import("./pages/Dashboard"));
const RoadMap = lazy(() => import("./pages/RoadMap"));
const RoadAssessment = lazy(() => import("./pages/RoadAssessment"));
const AIDamageAnalysis = lazy(() => import("./pages/AIDamageAnalysis"));
const History = lazy(() => import("./pages/History"));
const ModelPerformance = lazy(() => import("./pages/ModelPerformance"));
const ProjectOverview = lazy(() => import("./pages/ProjectOverview"));
const Settings = lazy(() => import("./pages/Settings"));

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Login />} />

        <Route element={<AppLayout />}>
          <Route path="/dashboard" element={<Dashboard />} />
          <Route path="/road-map" element={<RoadMap />} />
          <Route path="/road-assessment" element={<RoadAssessment />} />
          <Route path="/ai-analysis" element={<AIDamageAnalysis />} />
          <Route path="/history" element={<History />} />
          <Route path="/history/:recordId" element={<History />} />
          <Route path="/model-performance" element={<ModelPerformance />} />
          <Route path="/project-overview" element={<ProjectOverview />} />
          <Route path="/settings" element={<Settings />} />
        </Route>

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
