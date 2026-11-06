import {
  ChevronRight,
  ClipboardCheck,
  FileText,
  LayoutDashboard,
  LogOut,
  Map,
  Menu,
  Settings as SettingsIcon,
  X,
} from "lucide-react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { useState } from "react";

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
  const location = useLocation();
  const navigate = useNavigate();

  const currentPage =
    [...navigation, ...secondaryNavigation].find(
      (item) => item.path === location.pathname
    )?.label || "Dashboard";

  const handleLogout = () => {
    navigate("/");
  };

  return (
    <div className="app-shell">
      {mobileOpen && (
        <div
          className="mobile-overlay"
          onClick={() => setMobileOpen(false)}
        />
      )}

      <aside className={`sidebar ${mobileOpen ? "sidebar-open" : ""}`}>
        <div className="sidebar-brand">
          <div className="sidebar-logo">RR</div>

          <div>
            <strong>ROAD</strong>
            <strong>RESILIENCE</strong>
          </div>

          <button
            className="sidebar-close"
            onClick={() => setMobileOpen(false)}
          >
            <X size={20} />
          </button>
        </div>

        <div className="sidebar-section-label">
          ENGINEERING
        </div>

        <nav className="sidebar-nav">
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

        <nav className="sidebar-nav">
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
          <button className="logout-button" onClick={handleLogout}>
            <LogOut size={18} />
            Sign out
          </button>
        </div>
      </aside>

      <main className="main-content">
        <header className="topbar">
          <div className="topbar-left">
            <button
              className="mobile-menu"
              onClick={() => setMobileOpen(true)}
            >
              <Menu size={22} />
            </button>

            <div className="breadcrumb">
              <span>Engineer Portal</span>
              <ChevronRight size={15} />
              <strong>{currentPage}</strong>
            </div>
          </div>

          <div className="engineer-profile">
            <div className="engineer-avatar">VE</div>

            <div>
              <strong>Engineer</strong>
              <span>Road Infrastructure</span>
            </div>
          </div>
        </header>

        <div className="page-content">
          <Outlet />
        </div>
      </main>
    </div>
  );
}

export default AppLayout;