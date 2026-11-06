import { useState } from "react";
import type { FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowRight, Eye, EyeOff, ShieldCheck } from "lucide-react";

function Login() {
  const navigate = useNavigate();

  const [showPassword, setShowPassword] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    console.log("Login clicked");
    navigate("/dashboard");
  };

  return (
    <main className="login-page">
      <div className="login-background" />
      <div className="login-overlay" />

      <section className="login-card">
        <div className="login-brand">
          <div className="brand-mark">RR</div>

          <div>
            <h1>ROAD RESILIENCE</h1>
            <span>AI + GIS ENGINEERING PLATFORM</span>
          </div>
        </div>

        <div className="login-heading">
          <p className="eyebrow">ENGINEER PORTAL</p>

          <h2>Road infrastructure intelligence.</h2>

          <p>
            Access the AI-powered road assessment and maintenance
            prioritization workspace.
          </p>
        </div>

        <form
          onSubmit={handleSubmit}
          className="login-form"
          noValidate
        >
          <label>
            Work email

            <input
              type="text"
              placeholder="engineer@roadresilience.com"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
          </label>

          <label>
            Password

            <div className="password-field">
              <input
                type={showPassword ? "text" : "password"}
                placeholder="Enter your password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
              />

              <button
                type="button"
                onClick={() =>
                  setShowPassword(!showPassword)
                }
              >
                {showPassword ? (
                  <EyeOff size={18} />
                ) : (
                  <Eye size={18} />
                )}
              </button>
            </div>
          </label>

          <button
            className="login-button"
            type="submit"
          >
            <span>Sign in to workspace</span>
            <ArrowRight size={18} />
          </button>
        </form>

        <div className="security-note">
          <ShieldCheck size={18} />

          <div>
            <strong>Workspace access</strong>
            <span>
              Local access is enabled for this presentation workspace.
            </span>
          </div>
        </div>

        <p className="login-footer">
          AI-Driven Road Resilience & Maintenance
          Prioritization System
        </p>
      </section>
    </main>
  );
}

export default Login;