import { Link } from "react-router-dom";
import { ArrowUpRight, Database, Eye, KeyRound, MapPin, Settings as SettingsIcon } from "lucide-react";
import "./WorkspacePages.css";

function Settings() {
  return (
    <div className="content-page">
      <section className="section-heading">
        <div><p className="eyebrow">WORKSPACE</p><h1>Settings</h1><p>Understand your workspace, data storage, and assessment rules.</p></div>
        <span className="workspace-readonly"><Eye size={15} />Configuration reference</span>
      </section>
      <section className="settings-grid workspace-settings-grid">
        <div className="panel">
          <div className="panel-header"><div><p className="panel-kicker">WORKSPACE PROFILE</p><h2>Built for engineering review</h2></div><SettingsIcon size={21} /></div>
          <div className="settings-profile"><div className="large-avatar">EN</div><div><strong>Engineer workspace</strong><span>Road infrastructure assessment</span></div></div>
          <div className="config-list"><Setting label="Workflow" value="Upload → assess → review" /><Setting label="Access" value="Public workspace; account sign-in is not configured" /><Setting label="Configuration" value="Managed by the project administrator" /></div>
        </div>
        <div className="panel">
          <div className="panel-header"><div><p className="panel-kicker">DATA & HISTORY</p><h2>Saved with every analysis</h2></div><Database size={21} /></div>
          <div className="workspace-settings-copy"><p>Original images, annotated results, detections, and location assessments are saved by the backend. The live deployment uses Supabase PostgreSQL.</p><Link className="workspace-text-link" to="/history">Open analysis history<ArrowUpRight size={16} /></Link></div>
          <div className="workspace-settings-note"><KeyRound size={18} /><div><strong>Deletion requires a key</strong><p>Open a saved analysis to delete it. The administrator's deletion key protects this action.</p></div></div>
        </div>
      </section>
      <section className="panel workspace-rules-panel">
        <div className="panel-header"><div><p className="panel-kicker">ASSESSMENT RULES</p><h2>How to read the results</h2></div><MapPin size={21} /></div>
        <div className="workspace-rule-grid">
          <div><span className="workspace-rule-number">01</span><h3>Location comes from the image</h3><p>GPS is extracted from EXIF metadata or a readable coordinate stamp. An image without readable GPS stays unlocated.</p></div>
          <div><span className="workspace-rule-number">02</span><h3>Road matching has a boundary</h3><p>A segment is assigned only within 30 metres of the configured road geometry. Located images can still appear as unmatched points.</p></div>
          <div><span className="workspace-rule-number">03</span><h3>Scores support review</h3><p>PCI and MPI are visual, count-based proxies. They help organize observations and require engineering validation.</p></div>
        </div>
      </section>
      <div className="workspace-reference-note">Model validation metrics describe the reported training run. They do not measure accuracy on a newly uploaded image. <Link to="/model-performance">View model performance<ArrowUpRight size={14} /></Link></div>
    </div>
  );
}

function Setting({ label, value }: { label: string; value: string }) {
  return <div className="config-row"><span>{label}</span><strong>{value}</strong></div>;
}

export default Settings;
