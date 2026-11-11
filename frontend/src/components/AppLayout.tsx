import {
  BarChart3,
  BrainCircuit,
  ChevronRight,
  ClipboardCheck,
  FileText,
  History,
  LayoutDashboard,
  LogOut,
  Map,
  Menu,
  Settings as SettingsIcon,
  X,
  Route as RouteIcon,
  Plus,
  ArrowUpRight,
} from "lucide-react";
import { Link, NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { Suspense, useEffect, useRef, useState } from "react";

const navigation = [
  {
    label: "Dashboard",
    path: "/dashboard",
    icon: LayoutDashboard,
  },
  {
    label: "Road Map",
    path: "/road-map",
    icon: Map,
  },
  {
    label: "Road Assessment",
    path: "/road-assessment",
    icon: ClipboardCheck,
  },
  {
    label: "AI Damage Analysis",
    path: "/ai-analysis",
    icon: BrainCircuit,
  },
  {
    label: "History",
    path: "/history",
    icon: History,
  },
  {
    label: "Model Performance",
    path: "/model-performance",
    icon: BarChart3,
  },
];

const secondaryNavigation = [
  {
    label: "Project Overview",
    path: "/project-overview",
    icon: FileText,
  },
  {
    label: "Settings",
    path: "/settings",
    icon: SettingsIcon,
  },
];

function AppLayout() {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [isMobile, setIsMobile] = useState(() => window.matchMedia("(max-width: 900px)").matches);
  const navigationRef = useRef<HTMLElement>(null);
  const menuRef = useRef<HTMLButtonElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const location = useLocation();
  const navigate = useNavigate();

  useEffect(() => { window.scrollTo({ top: 0 }); }, [location.pathname]);

  useEffect(() => {
    const media = window.matchMedia("(max-width: 900px)");
    const onChange = (event: MediaQueryListEvent) => { setIsMobile(event.matches); if (!event.matches) setMobileOpen(false); };
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, []);

  useEffect(() => {
    if (!mobileOpen) return;
    const menuButton = menuRef.current;
    closeRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMobileOpen(false);
      if (event.key !== "Tab") return;
      const controls = navigationRef.current?.querySelectorAll<HTMLElement>("a[href], button:not([disabled])");
      if (!controls?.length) return;
      const first = controls[0];
      const last = controls[controls.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", onKey);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.removeEventListener("keydown", onKey); document.body.style.overflow = previousOverflow; if (menuButton?.offsetParent != null) menuButton.focus(); };
  }, [mobileOpen]);

  const currentPage =
    [...navigation, ...secondaryNavigation].find(
      (item) => location.pathname === item.path || location.pathname.startsWith(`${item.path}/`)
    )?.label || "Dashboard";

  const handleLogout = () => {
    navigate("/");
  };

  return (
    <div className="app-shell">
      <a className="skip-link" href="#workspace-content">Skip to content</a>
      {mobileOpen && (
        <button
          className="mobile-overlay"
          type="button"
          aria-label="Close navigation"
          tabIndex={-1}
          onClick={() => setMobileOpen(false)}
        />
      )}

      <aside ref={navigationRef} id="workspace-navigation" className={`sidebar ${mobileOpen ? "sidebar-open" : ""}`} aria-label="Workspace navigation" inert={isMobile && !mobileOpen} role={isMobile && mobileOpen ? "dialog" : undefined} aria-modal={isMobile && mobileOpen ? true : undefined}>
        <div className="sidebar-brand">
          <div className="sidebar-logo"><RouteIcon size={23} strokeWidth={2} /></div>

          <div>
            <strong>Road Resilience</strong>
            <span>Infrastructure intelligence</span>
          </div>

          <button
            className="sidebar-close"
            ref={closeRef}
            type="button"
            aria-label="Close navigation"
            onClick={() => setMobileOpen(false)}
          >
            <X size={20} />
          </button>
        </div>

        <div className="sidebar-section-label">
          WORKSPACE
        </div>

        <nav className="sidebar-nav" aria-label="Main navigation">
          {navigation.map((item) => {
            const Icon = item.icon;

            return (
              <NavLink
                key={item.path}
                to={item.path}
                onClick={() => setMobileOpen(false)}
                className={({ isActive }) =>
                  `sidebar-link ${isActive ? "active" : ""}`
                }
              >
                <Icon size={19} />
                <span>{item.label}</span>

                <ChevronRight
                  size={15}
                  className="sidebar-chevron"
                />
              </NavLink>
            );
          })}
        </nav>

        <div className="sidebar-section-label secondary-label">
          SYSTEM
        </div>

        <nav className="sidebar-nav" aria-label="Project navigation">
          {secondaryNavigation.map((item) => {
            const Icon = item.icon;

            return (
              <NavLink
                key={item.path}
                to={item.path}
                onClick={() => setMobileOpen(false)}
                className={({ isActive }) =>
                  `sidebar-link ${isActive ? "active" : ""}`
                }
              >
                <Icon size={19} />
                <span>{item.label}</span>

                <ChevronRight
                  size={15}
                  className="sidebar-chevron"
                />
              </NavLink>
            );
          })}
        </nav>

        <div className="sidebar-bottom">
          <Link className="sidebar-project-card" to="/project-overview" onClick={() => setMobileOpen(false)}><span className="sidebar-project-icon"><RouteIcon size={19} /></span><strong>Better roads start here.</strong><span>Turn road imagery into actionable assessments.</span><span className="sidebar-project-link">About the project <ArrowUpRight size={14} /></span></Link>
          <button className="logout-button" onClick={handleLogout}>
            <LogOut size={18} />
            Leave workspace
          </button>
        </div>
      </aside>

      <div className="main-content">
        <header className="topbar">
          <div className="topbar-left">
            <button
              className="mobile-menu"
              ref={menuRef}
              type="button"
              aria-label="Open navigation"
              aria-expanded={mobileOpen}
              aria-controls="workspace-navigation"
              onClick={() => setMobileOpen(true)}
            >
              <Menu size={22} />
            </button>

            <div className="breadcrumb">
              <span>Workspace</span>
              <ChevronRight size={15} />
              <strong>{currentPage}</strong>
            </div>
          </div>

          <div className="topbar-actions">
          <Link className="topbar-create" to="/ai-analysis"><Plus size={16} /><span>New analysis</span></Link>
          <div className="engineer-profile">
            <div className="engineer-avatar">EN</div>

            <div>
              <strong>Engineer</strong>
              <span>Engineering workspace</span>
            </div>
          </div>
          </div>
        </header>

        <main className="page-content" id="workspace-content" tabIndex={-1}>
          <Suspense fallback={<div className="loading-state" role="status"><span className="loading-spinner" />Loading workspace…</div>}><Outlet /></Suspense>
        </main>
        <footer className="workspace-footer"><span><RouteIcon size={14} />Road Resilience</span><span>AI assisted assessments · Review before planning maintenance</span></footer>
      </div>
    </div>
  );
}

export default AppLayout;
