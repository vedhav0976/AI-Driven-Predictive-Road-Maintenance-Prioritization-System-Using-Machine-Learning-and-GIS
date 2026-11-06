import {
  Settings as SettingsIcon,
} from "lucide-react";

function Settings() {
  return (
    <div className="content-page">
      <section className="section-heading">
        <div>
          <p className="eyebrow">SYSTEM CONFIGURATION</p>
          <h1>Settings</h1>
          <p>
            Review the active workspace and evidence boundaries.
          </p>
        </div>
      </section>

      <section className="settings-grid">
        <div className="panel">
          <div className="panel-header">
            <div>
              <p className="panel-kicker">WORKSPACE</p>
              <h2>Engineer profile</h2>
            </div>

            <SettingsIcon size={21} />
          </div>

          <div className="settings-profile">
            <div className="large-avatar">VE</div>

            <div>
              <strong>Engineer</strong>
              <span>Road Infrastructure</span>
            </div>
          </div>

          <div className="settings-field">
            <span>Role</span>
            <strong>Engineer / Analyst</strong>
          </div>

          <div className="settings-field">
            <span>Access level</span>
            <strong>Engineering workspace</strong>
          </div>
          <div className="settings-field">
            <span>Data boundary</span>
            <strong>RDD2022 validation + Mapillary observations</strong>
          </div>
        </div>
        <div className="panel">
          <div className="panel-header"><div><p className="panel-kicker">EVIDENCE POLICY</p><h2>What is shown</h2></div></div>
          <div className="priority-summary"><p>Inference outputs, saved validation metrics, and geolocated observations are displayed from project files or the connected backend.</p><p className="muted-copy">No road-segment match or external database connection is claimed when the underlying evidence is unavailable.</p></div>
        </div>
      </section>
    </div>
  );
}

export default Settings;