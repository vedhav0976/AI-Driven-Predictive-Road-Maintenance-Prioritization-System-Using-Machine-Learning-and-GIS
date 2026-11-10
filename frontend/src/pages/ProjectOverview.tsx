import {
  BrainCircuit,
  Globe2,
  Map,
  Server,
} from "lucide-react";

const objectives = [
  "Automatically detect road damage using computer vision.",
  "Classify potholes and different road-damage categories.",
  "Locate detected damage using geotagged imagery and GIS.",
  "Rank detected damage observations for maintenance review.",
  "Visualize road intelligence through an engineer dashboard.",
];

function ProjectOverview() {
  return (
    <div className="content-page">
      <section className="section-heading">
        <div>
          <p className="eyebrow">PROJECT DOCUMENTATION</p>

          <h1>Project overview</h1>

          <p>
            AI-driven road resilience and maintenance
            prioritization system for India.
          </p>
        </div>
      </section>

      <section className="overview-hero">
        <div>
          <span className="overview-label">
            PROJECT TITLE
          </span>

          <h2>
            AI-Driven Road Resilience and Maintenance
            Prioritization System for India Using Computer Vision
            and GIS
          </h2>

          <p>
            AI detects what is wrong with the road, GIS shows where
            it is, and the system helps prioritize roads that
            require maintenance.
          </p>
        </div>
      </section>

      <section className="overview-grid">
        <div className="panel">
          <div className="panel-header">
            <div>
              <p className="panel-kicker">OBJECTIVES</p>
              <h2>System objectives</h2>
            </div>
          </div>

          <div className="objective-list">
            {objectives.map((objective, index) => (
              <div className="objective-item" key={objective}>
                <span>
                  {String(index + 1).padStart(2, "0")}
                </span>

                <p>{objective}</p>
              </div>
            ))}
          </div>
        </div>

        <div className="panel">
          <div className="panel-header">
            <div>
              <p className="panel-kicker">TECHNOLOGY</p>
              <h2>Technology stack</h2>
            </div>
          </div>

          <div className="tech-grid">
            <Tech
              icon={<BrainCircuit />}
              title="AI / ML"
              text="YOLO · Python · Ultralytics"
            />

            <Tech
              icon={<Map />}
              title="GIS"
              text="Leaflet · React-Leaflet · OSM"
            />

            <Tech
              icon={<Server />}
              title="Backend"
              text="FastAPI · Python"
            />

            <Tech
              icon={<Globe2 />}
              title="Imagery"
              text="Mapillary · Geotagged images"
            />
          </div>
        </div>
      </section>

      <section className="overview-grid">
        <div className="panel">
          <div className="panel-header"><div><p className="panel-kicker">PROPOSED SOLUTION</p><h2>From image to maintenance review</h2></div></div>
          <div className="objective-list">
            <div className="objective-item"><span>01</span><p>YOLO detects and classifies visible road damage in uploaded imagery.</p></div>
            <div className="objective-item"><span>02</span><p>Mapillary coordinates place available observations on a Bengaluru Leaflet map.</p></div>
            <div className="objective-item"><span>03</span><p>Confidence-weighted observation scores help engineers review potential maintenance needs.</p></div>
          </div>
        </div>
        <div className="panel">
          <div className="panel-header"><div><p className="panel-kicker">DATA SOURCES</p><h2>Evidence used by the system</h2></div></div>
          <div className="config-list"><Config label="Training dataset" value="RDD2022 India" /><Config label="Image observations" value="Repository-backed Mapillary metadata" /><Config label="Validation evidence" value="Saved YOLO results.csv files" /><Config label="Map layer" value="OpenStreetMap tiles + observation points" /></div>
        </div>
      </section>

      <section className="panel architecture-panel">
        <div className="panel-header">
          <div>
            <p className="panel-kicker">SYSTEM ARCHITECTURE</p>
            <h2>End-to-end pipeline</h2>
          </div>
        </div>

        <div className="architecture-flow">
          <FlowItem
            title="RDD2022 India"
            subtitle="Training data"
          />

          <FlowArrow />

          <FlowItem
            title="YOLO"
            subtitle="Damage detection"
          />

          <FlowArrow />

          <FlowItem
            title="Mapillary"
            subtitle="Geotagged imagery"
          />

          <FlowArrow />

          <FlowItem
            title="Observation priority"
            subtitle="Maintenance review"
          />

          <FlowArrow />

          <FlowItem
            title="Engineer Portal"
            subtitle="GIS visualization"
          />
        </div>
      </section>

      <section className="overview-grid">
        <div className="panel">
          <div className="panel-header"><div><p className="panel-kicker">WORKFLOWS</p><h2>ML and GIS workflow</h2></div></div>
          <div className="config-list"><Config label="ML workflow" value="Decode image → YOLO inference → class, confidence, box" /><Config label="GIS workflow" value="Read coordinates → map observation → inspect popup evidence" /><Config label="Prioritization" value="Confidence-weighted observation review" /></div>
        </div>
        <div className="panel">
          <div className="panel-header"><div><p className="panel-kicker">LIMITATIONS & NEXT STEPS</p><h2>Scope for future work</h2></div></div>
          <div className="priority-summary"><p>Road-segment geometry, OSM matching, traffic exposure, maintenance history, and measured condition scores are not currently available.</p><p className="muted-copy">Future work can add validated road-network data, segment aggregation, and richer engineering risk factors.</p></div>
        </div>
      </section>

    </div>
  );
}

function Tech({
  icon,
  title,
  text,
}: {
  icon: React.ReactNode;
  title: string;
  text: string;
}) {
  return (
    <div className="tech-card">
      {icon}

      <strong>{title}</strong>

      <span>{text}</span>
    </div>
  );
}

function FlowItem({
  title,
  subtitle,
}: {
  title: string;
  subtitle: string;
}) {
  return (
    <div className="flow-item">
      <strong>{title}</strong>
      <span>{subtitle}</span>
    </div>
  );
}

function FlowArrow() {
  return <div className="flow-arrow">→</div>;
}

function Config({ label, value }: { label: string; value: string }) {
  return <div className="config-row"><span>{label}</span><strong>{value}</strong></div>;
}

export default ProjectOverview;
