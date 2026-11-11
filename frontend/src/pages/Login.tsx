import { Link } from "react-router-dom";
import { ArrowRight, BrainCircuit, Check, MapPin, Route, ScanLine } from "lucide-react";
import "./WorkspacePages.css";

function Login() {
  return (
    <main className="portal-entry">
      <section className="portal-story" aria-labelledby="portal-title">
        <Link className="portal-brand" to="/" aria-label="Road Resilience home">
          <span className="portal-brand-mark"><Route size={25} strokeWidth={2.4} /></span>
          <span>Road Resilience<small>INFRASTRUCTURE INTELLIGENCE</small></span>
        </Link>
        <div className="portal-story-content">
          <p className="portal-eyebrow"><span />AI + GIS, WORKING TOGETHER</p>
          <h1 id="portal-title">Better roads begin<br />with a clearer picture.</h1>
          <p>Turn road imagery into visible damage detections, mapped observations, and a focused maintenance review.</p>
          <div className="portal-capabilities">
            <span><ScanLine size={17} />Detect damage</span>
            <span><MapPin size={17} />Locate observations</span>
            <span><Route size={17} />Prioritize review</span>
          </div>
        </div>
        <div className="portal-road-illustration" aria-hidden="true">
          <svg viewBox="0 0 640 250" fill="none">
            <path className="portal-road-shadow" d="M-30 208C96 208 106 67 234 67S362 202 482 174 541 39 676 39" />
            <path className="portal-road" d="M-30 208C96 208 106 67 234 67S362 202 482 174 541 39 676 39" />
            <path className="portal-road-center" d="M-30 208C96 208 106 67 234 67S362 202 482 174 541 39 676 39" />
            <circle cx="228" cy="67" r="16" fill="#132e36" stroke="#5bc9a4" strokeWidth="3" />
            <circle cx="228" cy="67" r="5" fill="#5bc9a4" />
            <circle cx="480" cy="174" r="16" fill="#132e36" stroke="#e6bd72" strokeWidth="3" />
            <circle cx="480" cy="174" r="5" fill="#e6bd72" />
            <path d="M228 44V22M480 196V221" stroke="#87a9a6" strokeDasharray="3 4" />
          </svg>
          <span className="portal-map-tag"><span />Image to insight</span>
        </div>
        <p className="portal-story-footer">Built for road assessment. Designed for informed decisions.</p>
      </section>

      <section className="portal-welcome" aria-labelledby="welcome-title">
        <div className="portal-welcome-inner">
          <div className="portal-welcome-icon"><BrainCircuit size={28} /></div>
          <p className="eyebrow">YOUR ENGINEERING WORKSPACE</p>
          <h2 id="welcome-title">A view of every observation.</h2>
          <p className="portal-welcome-copy">Upload road images, review the evidence, and keep your next maintenance decision in view.</p>
          <ul className="portal-entry-list">
            <li><Check size={16} /><span>Single images, folders, and public Drive links</span></li>
            <li><Check size={16} /><span>Saved results with original and annotated images</span></li>
            <li><Check size={16} /><span>GPS mapping and road priority review</span></li>
          </ul>
          <Link className="portal-open-button" to="/dashboard">Open workspace<ArrowRight size={19} /></Link>
          <p className="portal-access-note">This workspace currently opens without account sign-in.</p>
          <Link className="portal-overview-link" to="/project-overview">Explore how the system works<ArrowRight size={15} /></Link>
        </div>
        <p className="portal-welcome-footer">ROAD RESILIENCE <span>Computer vision. Spatial context.</span></p>
      </section>
    </main>
  );
}

export default Login;
