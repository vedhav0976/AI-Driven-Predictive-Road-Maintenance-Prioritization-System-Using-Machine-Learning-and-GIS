import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";

import AppLayout from "./components/AppLayout";
import Login from "./pages/Login";
import Dashboard from "./pages/Dashboard";
import RoadMap from "./pages/RoadMap";
import RoadAssessment from "./pages/RoadAssessment";
import AIDamageAnalysis from "./pages/AIDamageAnalysis";
import ModelPerformance from "./pages/ModelPerformance";
import ProjectOverview from "./pages/ProjectOverview";
import Settings from "./pages/Settings";

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