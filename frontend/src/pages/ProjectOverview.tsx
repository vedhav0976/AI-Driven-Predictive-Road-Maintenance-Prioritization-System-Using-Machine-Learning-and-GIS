import { Link } from "react-router-dom";
import { ArrowRight, BrainCircuit, Database, Map, ScanLine } from "lucide-react";
import "./WorkspacePages.css";

const workflow = [
  { title: "Bring in imagery", text: "Upload one image or build a queue from local files, folders, and public Drive links.", icon: ScanLine },
  { title: "Detect visible damage", text: "The YOLO checkpoint identifies damage classes, confidence values, and bounding boxes.", icon: BrainCircuit },
  { title: "Add spatial context", text: "Read GPS from the image and match the nearest available road segment within 30 metres.", icon: Map },
  { title: "Save and prioritize", text: "Store the evidence and calculate visual PCI/MPI proxies for maintenance review.", icon: Database },
];

function ProjectOverview() {
  return (
    <div className="content-page">
      <section className="section-heading"><div><p className="eyebrow">ABOUT THE WORKSPACE</p><h1>From road image to informed review.</h1><p>Computer vision and GIS bring road observations into one engineering workflow.</p></div></section>
      <section className="overview-hero workspace-overview-hero">
        <div><span className="overview-label">ROAD RESILIENCE</span><h2>See the damage.<br />Understand the location.<br /><em>Focus the next action.</em></h2><p>An AI-driven road maintenance and spatial prioritization system that connects image evidence, road geography, and saved assessments.</p><Link className="workspace-hero-link" to="/ai-analysis">Analyze a road image<ArrowRight size={17} /></Link></div>
        <div className="workspace-overview-orbit" aria-hidden="true"><div><Map size={54} strokeWidth={1.3} /><span>IMAGE + LOCATION</span></div><i /><i /></div>
      </section>
      <section className="panel workspace-workflow-panel">
        <div className="panel-header"><div><p className="panel-kicker">THE WORKFLOW</p><h2>One connected pipeline</h2></div><span className="muted-text">Four steps, with evidence at each stage</span></div>
        <div className="workspace-workflow-grid">{workflow.map((step, index) => <div key={step.title}><div className="workspace-workflow-top"><span>{String(index + 1).padStart(2, "0")}</span><step.icon size={22} /></div><h3>{step.title}</h3><p>{step.text}</p></div>)}</div>
      </section>
      <section className="overview-grid">
        <div className="panel"><div className="panel-header"><div><p className="panel-kicker">UNDER THE HOOD</p><h2>Technology with a clear role</h2></div></div><div className="config-list"><Config label="Detection" value="YOLO · Python · Ultralytics" /><Config label="Spatial review" value="Leaflet · OpenStreetMap · GIS matching" /><Config label="Application" value="React · FastAPI" /><Config label="Live data storage" value="Supabase PostgreSQL" /></div></div>
        <div className="panel"><div className="panel-header"><div><p className="panel-kicker">SAVED EVIDENCE</p><h2>Trace a result to its source</h2></div></div><div className="workspace-settings-copy"><p>Every saved analysis includes its original image, annotated output, detections, extracted coordinates, and road assessment. Reopen it from History without running the model again.</p><Link className="workspace-text-link" to="/history">Review saved analyses<ArrowRight size={16} /></Link></div></div>
      </section>
      <section className="panel workspace-scope-panel"><div className="panel-header"><div><p className="panel-kicker">READING THE EVIDENCE</p><h2>Built to support engineering judgment</h2></div></div><div className="workspace-scope-grid"><div><h3>What the system provides</h3><p>Visible damage detections, image-based GPS, configured road matching, and count-based priority proxies. Optional Mapillary records can supply additional imagery observations.</p></div><div><h3>What still needs validation</h3><p>Model detections, GPS accuracy, road assignments, and condition proxies need field review. Traffic exposure, maintenance history, and measured pavement condition are not included in the current score.</p></div></div></section>
    </div>
  );
}

function Config({ label, value }: { label: string; value: string }) {
  return <div className="config-row"><span>{label}</span><strong>{value}</strong></div>;
}

export default ProjectOverview;
