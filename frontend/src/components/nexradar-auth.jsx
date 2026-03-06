import { useState, useRef } from "react";

/* ═══════════════════════════════════════════════════════════
   NEXRADAR PRO — Authentication Pages
   Sign In · Sign Up · matching nexradar.info brand identity
   Dark terminal aesthetic · IBM Plex Mono + Exo 2
   supabase client is passed in as a prop from App.jsx
═══════════════════════════════════════════════════════════ */

const CSS = `
  @import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@300;400;500;600;700&family=Exo+2:wght@300;400;600;700;800&display=swap');

  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  html, body { height: 100%; background: #04080f; }
  ::-webkit-scrollbar { width: 4px; }
  ::-webkit-scrollbar-thumb { background: #1a2d42; border-radius: 2px; }

  @keyframes gridPan {
    0%   { transform: translate(0, 0); }
    100% { transform: translate(52px, 52px); }
  }
  @keyframes radarSpin {
    from { transform: rotate(0deg); }
    to   { transform: rotate(360deg); }
  }
  @keyframes radarFade {
    0%   { opacity: 0.7; }
    100% { opacity: 0; }
  }
  @keyframes pulseRing {
    0%   { transform: scale(0.95); opacity: 0.6; }
    100% { transform: scale(1.6);  opacity: 0; }
  }
  @keyframes fadeUp {
    from { opacity: 0; transform: translateY(20px); }
    to   { opacity: 1; transform: translateY(0); }
  }
  @keyframes slideIn {
    from { opacity: 0; transform: translateX(-16px); }
    to   { opacity: 1; transform: translateX(0); }
  }
  @keyframes blink {
    0%, 100% { opacity: 1; }
    50%       { opacity: 0; }
  }
  @keyframes scanline {
    0%   { top: -2px; }
    100% { top: 100%; }
  }
  @keyframes glowPulse {
    0%, 100% { box-shadow: 0 0 20px #00d4e820, 0 0 40px #00d4e808; }
    50%       { box-shadow: 0 0 32px #00d4e838, 0 0 64px #00d4e814; }
  }

  .page-enter { animation: fadeUp 0.45s cubic-bezier(0.16,1,0.3,1) both; }
  .form-enter { animation: fadeUp 0.5s cubic-bezier(0.16,1,0.3,1) 0.1s both; }
  .field-enter-1 { animation: fadeUp 0.4s cubic-bezier(0.16,1,0.3,1) 0.15s both; opacity: 0; }
  .field-enter-2 { animation: fadeUp 0.4s cubic-bezier(0.16,1,0.3,1) 0.22s both; opacity: 0; }
  .field-enter-3 { animation: fadeUp 0.4s cubic-bezier(0.16,1,0.3,1) 0.29s both; opacity: 0; }
  .field-enter-4 { animation: fadeUp 0.4s cubic-bezier(0.16,1,0.3,1) 0.36s both; opacity: 0; }

  .input-field {
    width: 100%;
    background: #08111c;
    border: 1px solid #1a2d42;
    border-radius: 8px;
    padding: 14px 16px 14px 46px;
    color: #d0e8f8;
    font-family: 'IBM Plex Mono', monospace;
    font-size: 14px;
    outline: none;
    transition: border-color 0.2s, box-shadow 0.2s, background 0.2s;
    caret-color: #00d4e8;
  }
  .input-field::placeholder { color: #243850; }
  .input-field:focus {
    border-color: #00d4e855;
    background: #091520;
    box-shadow: 0 0 0 3px #00d4e810;
  }
  .input-field.error { border-color: #ff3d5a55; }
  .input-field.error:focus { box-shadow: 0 0 0 3px #ff3d5a10; }
  .input-field.success { border-color: #00e67655; }

  .submit-btn {
    width: 100%;
    padding: 15px;
    background: linear-gradient(135deg, #006880, #00d4e8);
    border: none;
    border-radius: 8px;
    color: #001820;
    font-family: 'Exo 2', sans-serif;
    font-size: 15px;
    font-weight: 700;
    letter-spacing: 2px;
    cursor: pointer;
    position: relative;
    overflow: hidden;
    transition: opacity 0.2s, transform 0.15s;
  }
  .submit-btn::before {
    content: '';
    position: absolute;
    inset: 0;
    background: linear-gradient(135deg, #00d4e8, #00a0cc);
    opacity: 0;
    transition: opacity 0.2s;
  }
  .submit-btn:hover { transform: translateY(-1px); }
  .submit-btn:hover::before { opacity: 1; }
  .submit-btn:active { transform: translateY(0); }
  .submit-btn span { position: relative; z-index: 1; }
  .submit-btn:disabled { opacity: 0.5; cursor: not-allowed; transform: none; }

  .tab-btn {
    flex: 1;
    padding: 12px;
    background: none;
    border: none;
    cursor: pointer;
    font-family: 'IBM Plex Mono', monospace;
    font-size: 12px;
    letter-spacing: 2px;
    color: #2e4558;
    border-bottom: 2px solid transparent;
    transition: color 0.2s, border-color 0.2s;
  }
  .tab-btn.active {
    color: #00d4e8;
    border-bottom-color: #00d4e8;
  }
  .tab-btn:hover:not(.active) { color: #4a7090; }

  .divider-line {
    flex: 1;
    height: 1px;
    background: linear-gradient(90deg, transparent, #1a2d42, transparent);
  }

  .social-btn {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    padding: 11px;
    background: #08111c;
    border: 1px solid #1a2d42;
    border-radius: 8px;
    color: #4a7090;
    font-family: 'IBM Plex Mono', monospace;
    font-size: 12px;
    cursor: pointer;
    transition: border-color 0.2s, color 0.2s, background 0.2s;
  }
  .social-btn:hover {
    border-color: #243850;
    color: #7aaccf;
    background: #091520;
  }

  .feature-item {
    display: flex;
    align-items: flex-start;
    gap: 14px;
    animation: slideIn 0.5s cubic-bezier(0.16,1,0.3,1) both;
  }

  .strength-bar {
    height: 3px;
    border-radius: 2px;
    background: #0e1e2e;
    flex: 1;
    overflow: hidden;
    transition: all 0.3s;
  }
`;

/* ── Radar Logo SVG ── */
function RadarMark({ size = 52 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 52 52">
      <defs>
        <radialGradient id="rg" cx="50%" cy="50%" r="50%">
          <stop offset="0%"   stopColor="#00d4e8" stopOpacity="0.15" />
          <stop offset="100%" stopColor="#00d4e8" stopOpacity="0" />
        </radialGradient>
      </defs>
      {/* outer ring */}
      <circle cx="26" cy="26" r="24" fill="none" stroke="#00d4e830" strokeWidth="1" />
      {/* mid ring */}
      <circle cx="26" cy="26" r="16" fill="none" stroke="#00d4e820" strokeWidth="0.5" />
      {/* inner ring */}
      <circle cx="26" cy="26" r="8"  fill="none" stroke="#00d4e840" strokeWidth="0.5" />
      {/* cross */}
      <line x1="26" y1="2"  x2="26" y2="50" stroke="#00d4e825" strokeWidth="0.5" />
      <line x1="2"  y1="26" x2="50" y2="26" stroke="#00d4e825" strokeWidth="0.5" />
      {/* N glyph */}
      <text x="26" y="31" textAnchor="middle"
        fill="#00d4e8" fontSize="18" fontFamily="'Exo 2', sans-serif" fontWeight="800">
        N
      </text>
      {/* radar sweep */}
      <g style={{ transformOrigin: "26px 26px", animation: "radarSpin 3s linear infinite" }}>
        <path d="M26 26 L26 2 A24 24 0 0 1 48 30 Z"
          fill="url(#rg)" />
        <line x1="26" y1="26" x2="26" y2="2"
          stroke="#00d4e8" strokeWidth="1.5" opacity="0.8" />
      </g>
      {/* blip dot */}
      <circle cx="36" cy="14" r="2" fill="#00d4e8" opacity="0.9" />
    </svg>
  );
}

/* ── Animated background grid ── */
function GridBackground() {
  return (
    <div style={{ position: "fixed", inset: 0, overflow: "hidden", pointerEvents: "none" }}>
      {/* Moving grid */}
      <div style={{
        position: "absolute", inset: "-60px",
        backgroundImage: `
          linear-gradient(#0d1e2e55 1px, transparent 1px),
          linear-gradient(90deg, #0d1e2e55 1px, transparent 1px)
        `,
        backgroundSize: "52px 52px",
        animation: "gridPan 8s linear infinite",
      }} />
      {/* Vignette */}
      <div style={{
        position: "absolute", inset: 0,
        background: "radial-gradient(ellipse 80% 80% at 50% 50%, transparent 30%, #04080f 100%)",
      }} />
      {/* Top-right glow */}
      <div style={{
        position: "absolute", top: -200, right: -200,
        width: 600, height: 600, borderRadius: "50%",
        background: "radial-gradient(circle, #00d4e808 0%, transparent 70%)",
      }} />
      {/* Bottom-left glow */}
      <div style={{
        position: "absolute", bottom: -200, left: -200,
        width: 500, height: 500, borderRadius: "50%",
        background: "radial-gradient(circle, #00a0cc06 0%, transparent 70%)",
      }} />
      {/* Scanline */}
      <div style={{
        position: "absolute", left: 0, right: 0, height: 2,
        background: "linear-gradient(90deg, transparent, #00d4e808, transparent)",
        animation: "scanline 6s linear infinite",
      }} />
    </div>
  );
}

/* ── Field component ── */
function Field({ label, icon, type = "text", placeholder, value, onChange,
  error, success, className = "" }) {
  const [show, setShow] = useState(false);
  const isPass = type === "password";
  const inputType = isPass ? (show ? "text" : "password") : type;

  return (
    <div className={className} style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <label style={{
        color: "#4a7090", fontSize: 11, fontFamily: "'IBM Plex Mono', monospace",
        letterSpacing: 2, textTransform: "uppercase",
      }}>{label}</label>
      <div style={{ position: "relative" }}>
        {/* Icon */}
        <span style={{
          position: "absolute", left: 14, top: "50%", transform: "translateY(-50%)",
          fontSize: 15, color: error ? "#ff3d5a60" : success ? "#00e67660" : "#1e3448",
          pointerEvents: "none",
        }}>{icon}</span>
        <input
          className={`input-field${error ? " error" : ""}${success ? " success" : ""}`}
          type={inputType}
          placeholder={placeholder}
          value={value}
          onChange={onChange}
          autoComplete={isPass ? "current-password" : type === "email" ? "email" : "name"}
        />
        {/* Password toggle */}
        {isPass && (
          <button onClick={() => setShow(s => !s)} style={{
            position: "absolute", right: 14, top: "50%", transform: "translateY(-50%)",
            background: "none", border: "none", cursor: "pointer",
            color: "#2e4558", fontSize: 14, padding: 2,
          }}>
            {show ? "🙈" : "👁"}
          </button>
        )}
      </div>
      {error && (
        <span style={{ color: "#ff3d5a", fontSize: 11, fontFamily: "'IBM Plex Mono', monospace" }}>
          ⚠ {error}
        </span>
      )}
    </div>
  );
}

/* ── Password strength ── */
function PasswordStrength({ password }) {
  const score = !password ? 0
    : (password.length >= 8 ? 1 : 0)
    + (/[A-Z]/.test(password) ? 1 : 0)
    + (/[0-9]/.test(password) ? 1 : 0)
    + (/[^A-Za-z0-9]/.test(password) ? 1 : 0);

  const labels = ["", "Weak", "Fair", "Good", "Strong"];
  const colors = ["#1a2d42", "#ff3d5a", "#ffb300", "#00d4e8", "#00e676"];

  if (!password) return null;
  return (
    <div style={{ marginTop: 6 }}>
      <div style={{ display: "flex", gap: 4, marginBottom: 4 }}>
        {[1, 2, 3, 4].map(i => (
          <div key={i} className="strength-bar">
            <div style={{
              height: "100%", width: i <= score ? "100%" : "0%",
              background: colors[score], borderRadius: 2,
              transition: "width 0.3s, background 0.3s",
            }} />
          </div>
        ))}
      </div>
      <span style={{ color: colors[score], fontSize: 10, fontFamily: "'IBM Plex Mono', monospace", letterSpacing: 1 }}>
        {labels[score]}
      </span>
    </div>
  );
}

/* ── Features panel ── */
function FeaturesPanel() {
  const features = [
    { icon: "📡", title: "Real-time Market Feed", desc: "Live WebSocket data across all your watchlist tickers" },
    { icon: "⚡", title: "Scalp Signal Engine", desc: "Automated detection of VOL spikes, breakouts & gaps" },
    { icon: "💎", title: "Diamond Screener", desc: "High-conviction setups filtered by quality score" },
    { icon: "📊", title: "Multi-page Dashboard", desc: "Live Table · Chart · Signals · Earnings · Portfolio" },
  ];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 28 }}>
      {features.map((f, i) => (
        <div key={f.title} className="feature-item"
          style={{ animationDelay: `${0.3 + i * 0.1}s` }}>
          <div style={{
            width: 42, height: 42, borderRadius: 10, flexShrink: 0,
            background: "#00d4e812", border: "1px solid #00d4e825",
            display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18,
          }}>{f.icon}</div>
          <div>
            <div style={{
              color: "#c0e0f0", fontSize: 13, fontFamily: "'Exo 2', sans-serif",
              fontWeight: 600, marginBottom: 3,
            }}>{f.title}</div>
            <div style={{ color: "#2e4558", fontSize: 12, fontFamily: "'IBM Plex Mono', monospace", lineHeight: 1.6 }}>
              {f.desc}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

/* ── Sign In form ── */
function SignIn({ onSwitch, onSuccess, supabase }) {
  const [email, setEmail]     = useState("");
  const [pass, setPass]       = useState("");
  const [loading, setLoading] = useState(false);
  const [errors, setErrors]   = useState({});
  const [authError, setAuthError] = useState(""); // server-side auth errors

  const validate = () => {
    const e = {};
    if (!email) e.email = "Email is required";
    else if (!/\S+@\S+\.\S+/.test(email)) e.email = "Enter a valid email";
    if (!pass) e.pass = "Password is required";
    else if (pass.length < 6) e.pass = "Minimum 6 characters";
    return e;
  };

  const handleSubmit = async () => {
    const e = validate();
    if (Object.keys(e).length) { setErrors(e); return; }
    setErrors({});
    setAuthError("");
    setLoading(true);

    const { data, error } = await supabase.auth.signInWithPassword({
      email: email.trim().toLowerCase(),
      password: pass,
    });

    setLoading(false);

    if (error) {
      // Map Supabase error messages to user-friendly text
      if (error.message.includes("Invalid login credentials")) {
        setAuthError("Incorrect email or password. Try again.");
      } else if (error.message.includes("Email not confirmed")) {
        setAuthError("Please confirm your email before signing in.");
      } else {
        setAuthError(error.message);
      }
      return;
    }

    // ✅ Signed in — call parent to transition to dashboard
    if (onSuccess) onSuccess(data.user);
  };

  const handleForgotPassword = async () => {
    if (!email || !/\S+@\S+\.\S+/.test(email)) {
      setErrors(v => ({ ...v, email: "Enter your email above first" }));
      return;
    }
    const { error } = await supabase.auth.resetPasswordForEmail(email.trim().toLowerCase(), {
      redirectTo: `${window.location.origin}/reset-password`,
    });
    if (error) {
      setAuthError(error.message);
    } else {
      setAuthError(""); // clear errors
      alert(`Password reset link sent to ${email}`); // or replace with a toast
    }
  };

  const handleOAuth = async (provider) => {
    const { error } = await supabase.auth.signInWithOAuth({
      provider, // "google" | "github"
      options: { redirectTo: window.location.origin },
    });
    if (error) setAuthError(error.message);
  };

  return (
    <div key="signin" style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      {/* Social row */}
      <div className="field-enter-1" style={{ display: "flex", gap: 10 }}>
        <button className="social-btn" onClick={() => handleOAuth("google")}>
          <svg width="16" height="16" viewBox="0 0 24 24">
            <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
            <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
            <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
            <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
          </svg>
          Google
        </button>
        <button className="social-btn" onClick={() => handleOAuth("github")}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="#7aaccf">
            <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0 0 24 12c0-6.63-5.37-12-12-12z"/>
          </svg>
          GitHub
        </button>
      </div>

      {/* Divider */}
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <div className="divider-line" />
        <span style={{ color: "#1e3448", fontSize: 11, fontFamily: "'IBM Plex Mono', monospace", whiteSpace: "nowrap" }}>
          OR SIGN IN WITH EMAIL
        </span>
        <div className="divider-line" />
      </div>

      {/* Auth error banner */}
      {authError && (
        <div style={{ background: "#ff3d5a12", border: "1px solid #ff3d5a35", borderRadius: 8,
          padding: "10px 14px", display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 14 }}>⚠️</span>
          <span style={{ color: "#ff6b7a", fontSize: 12, fontFamily: "'IBM Plex Mono', monospace" }}>
            {authError}
          </span>
        </div>
      )}

      <Field className="field-enter-2" label="Email address" icon="✉" type="email"
        placeholder="you@example.com" value={email}
        onChange={e => { setEmail(e.target.value); setErrors(v => ({...v, email: ""})); setAuthError(""); }}
        error={errors.email} success={email && !errors.email && /\S+@\S+\.\S+/.test(email)} />

      <Field className="field-enter-3" label="Password" icon="🔒" type="password"
        placeholder="Enter your password" value={pass}
        onChange={e => { setPass(e.target.value); setErrors(v => ({...v, pass: ""})); setAuthError(""); }}
        error={errors.pass} />

      {/* Forgot password */}
      <div className="field-enter-3" style={{ display: "flex", justifyContent: "flex-end", marginTop: -8 }}>
        <button onClick={handleForgotPassword} style={{ background: "none", border: "none", cursor: "pointer",
          color: "#00d4e8", fontSize: 12, fontFamily: "'IBM Plex Mono', monospace",
          opacity: 0.7, transition: "opacity 0.2s" }}
          onMouseEnter={e => e.target.style.opacity = 1}
          onMouseLeave={e => e.target.style.opacity = 0.7}>
          Forgot password?
        </button>
      </div>

      <div className="field-enter-4">
        <button className="submit-btn" onClick={handleSubmit} disabled={loading}>
          <span>{loading ? "Authenticating…" : "SIGN IN TO NEXRADAR"}</span>
        </button>
      </div>

      {/* Switch to sign up */}
      <div className="field-enter-4" style={{ textAlign: "center" }}>
        <span style={{ color: "#2e4558", fontSize: 13, fontFamily: "'IBM Plex Mono', monospace" }}>
          No account?{" "}
        </span>
        <button onClick={onSwitch} style={{
          background: "none", border: "none", cursor: "pointer",
          color: "#00d4e8", fontSize: 13, fontFamily: "'IBM Plex Mono', monospace",
          fontWeight: 600,
        }}>
          Create one →
        </button>
      </div>
    </div>
  );
}

/* ── Sign Up form ── */
function SignUp({ onSwitch, onSuccess, supabase }) {
  const [name, setName]       = useState("");
  const [email, setEmail]     = useState("");
  const [pass, setPass]       = useState("");
  const [agree, setAgree]     = useState(false);
  const [loading, setLoading] = useState(false);
  const [errors, setErrors]   = useState({});
  const [authError, setAuthError]     = useState("");
  const [signedUp, setSignedUp]       = useState(false); // show "check your email" state

  const validate = () => {
    const e = {};
    if (!name.trim()) e.name = "Full name is required";
    if (!email) e.email = "Email is required";
    else if (!/\S+@\S+\.\S+/.test(email)) e.email = "Enter a valid email";
    if (!pass) e.pass = "Password is required";
    else if (pass.length < 8) e.pass = "Minimum 8 characters";
    if (!agree) e.agree = "Please accept terms to continue";
    return e;
  };

  const handleSubmit = async () => {
    const e = validate();
    if (Object.keys(e).length) { setErrors(e); return; }
    setErrors({});
    setAuthError("");
    setLoading(true);

    const { data, error } = await supabase.auth.signUp({
      email: email.trim().toLowerCase(),
      password: pass,
      options: {
        data: { full_name: name.trim() }, // stored in user_metadata
        emailRedirectTo: window.location.origin,
      },
    });

    setLoading(false);

    if (error) {
      if (error.message.includes("already registered")) {
        setAuthError("This email is already registered. Try signing in instead.");
      } else {
        setAuthError(error.message);
      }
      return;
    }

    // Supabase requires email confirmation by default.
    // If you disable email confirmation in Supabase Auth settings,
    // data.session will be non-null and you can call onSuccess immediately.
    if (data.session) {
      // Email confirmation OFF — user is immediately signed in
      if (onSuccess) onSuccess(data.user);
    } else {
      // Email confirmation ON (default) — show "check your inbox" screen
      setSignedUp(true);
    }
  };

  const handleOAuth = async (provider) => {
    const { error } = await supabase.auth.signInWithOAuth({
      provider,
      options: { redirectTo: window.location.origin },
    });
    if (error) setAuthError(error.message);
  };

  // ── "Check your email" screen ─────────────────────────────────────────────
  if (signedUp) {
    return (
      <div style={{ display:"flex", flexDirection:"column", alignItems:"center", gap:20, padding:"12px 0" }}>
        <div style={{ fontSize:48 }}>📬</div>
        <div style={{ textAlign:"center" }}>
          <div style={{ color:"#c8e8f8", fontFamily:"'Exo 2', sans-serif", fontWeight:700, fontSize:18, marginBottom:8 }}>
            Confirm your email
          </div>
          <div style={{ color:"#2e4558", fontFamily:"'IBM Plex Mono', monospace", fontSize:12, lineHeight:1.8 }}>
            We sent a confirmation link to<br/>
            <span style={{ color:"#00d4e8" }}>{email}</span><br/>
            Click it to activate your account.
          </div>
        </div>
        <button onClick={onSwitch} style={{
          background:"none", border:"1px solid #1a2d42", borderRadius:8,
          padding:"10px 24px", cursor:"pointer",
          color:"#00d4e8", fontSize:12, fontFamily:"'IBM Plex Mono', monospace", fontWeight:600,
        }}>
          ← Back to Sign In
        </button>
      </div>
    );
  }

  return (
    <div key="signup" style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      {/* Social row */}
      <div className="field-enter-1" style={{ display: "flex", gap: 10 }}>
        <button className="social-btn" onClick={() => handleOAuth("google")}>
          <svg width="16" height="16" viewBox="0 0 24 24">
            <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
            <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
            <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
            <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
          </svg>
          Google
        </button>
        <button className="social-btn" onClick={() => handleOAuth("github")}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="#7aaccf">
            <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0 0 24 12c0-6.63-5.37-12-12-12z"/>
          </svg>
          GitHub
        </button>
      </div>

      {/* Divider */}
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <div className="divider-line" />
        <span style={{ color: "#1e3448", fontSize: 11, fontFamily: "'IBM Plex Mono', monospace", whiteSpace: "nowrap" }}>
          OR SIGN UP WITH EMAIL
        </span>
        <div className="divider-line" />
      </div>

      {/* Auth error banner */}
      {authError && (
        <div style={{ background: "#ff3d5a12", border: "1px solid #ff3d5a35", borderRadius: 8,
          padding: "10px 14px", display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 14 }}>⚠️</span>
          <span style={{ color: "#ff6b7a", fontSize: 12, fontFamily: "'IBM Plex Mono', monospace" }}>
            {authError}
          </span>
        </div>
      )}

      <Field className="field-enter-2" label="Full name" icon="👤" type="text"
        placeholder="Saranya R." value={name}
        onChange={e => { setName(e.target.value); setErrors(v => ({...v, name: ""})); }}
        error={errors.name} success={name.trim().length >= 2} />

      <Field className="field-enter-2" label="Email address" icon="✉" type="email"
        placeholder="you@example.com" value={email}
        onChange={e => { setEmail(e.target.value); setErrors(v => ({...v, email: ""})); setAuthError(""); }}
        error={errors.email} success={email && !errors.email && /\S+@\S+\.\S+/.test(email)} />

      <div className="field-enter-3">
        <Field label="Password" icon="🔒" type="password"
          placeholder="Minimum 8 characters" value={pass}
          onChange={e => { setPass(e.target.value); setErrors(v => ({...v, pass: ""})); }}
          error={errors.pass} />
        <PasswordStrength password={pass} />
      </div>

      {/* Terms */}
      <div className="field-enter-4">
        <label style={{ display: "flex", alignItems: "flex-start", gap: 10, cursor: "pointer" }}>
          <div onClick={() => { setAgree(v => !v); setErrors(v => ({...v, agree: ""})); }}
            style={{
              width: 18, height: 18, marginTop: 1, borderRadius: 4, flexShrink: 0,
              background: agree ? "#00d4e820" : "#08111c",
              border: `1px solid ${agree ? "#00d4e855" : errors.agree ? "#ff3d5a55" : "#1a2d42"}`,
              display: "flex", alignItems: "center", justifyContent: "center",
              transition: "all 0.2s", cursor: "pointer",
            }}>
            {agree && <span style={{ color: "#00d4e8", fontSize: 12, lineHeight: 1 }}>✓</span>}
          </div>
          <span style={{ color: "#2e4558", fontSize: 12, fontFamily: "'IBM Plex Mono', monospace", lineHeight: 1.6 }}>
            I agree to the{" "}
            <span style={{ color: "#00d4e8" }}>Terms of Service</span> and{" "}
            <span style={{ color: "#00d4e8" }}>Privacy Policy</span>
          </span>
        </label>
        {errors.agree && (
          <div style={{ color: "#ff3d5a", fontSize: 11, fontFamily: "'IBM Plex Mono', monospace", marginTop: 4 }}>
            ⚠ {errors.agree}
          </div>
        )}
      </div>

      <button className="submit-btn" onClick={handleSubmit} disabled={loading}>
        <span>{loading ? "Creating account…" : "CREATE ACCOUNT"}</span>
      </button>

      <div style={{ textAlign: "center" }}>
        <span style={{ color: "#2e4558", fontSize: 13, fontFamily: "'IBM Plex Mono', monospace" }}>
          Already have an account?{" "}
        </span>
        <button onClick={onSwitch} style={{
          background: "none", border: "none", cursor: "pointer",
          color: "#00d4e8", fontSize: 13, fontFamily: "'IBM Plex Mono', monospace",
          fontWeight: 600,
        }}>
          Sign in →
        </button>
      </div>
    </div>
  );
}

/* ══════════════ APP ══════════════ */
export default function NexRadarAuth({ onAuthenticated, supabase }) {
  const [mode, setMode] = useState("signin"); // "signin" | "signup"
  const [key, setKey]   = useState(0);

  // NOTE: Session checking is handled entirely by App.jsx via onAuthStateChange.
  // This component only renders when the user is NOT logged in.
  // handleSubmit / handleOAuth calls trigger onAuthStateChange in App.jsx → routing happens there.

  const switchMode = (m) => {
    setMode(m);
    setKey(k => k + 1);
  };

  return (
    <div style={{ minHeight: "100vh", background: "#04080f", display: "flex",
      flexDirection: "column", position: "relative" }}>
      <style>{CSS}</style>
      <GridBackground />

      {/* Top bar */}
      <div style={{ position: "relative", zIndex: 10, padding: "20px 32px",
        display: "flex", alignItems: "center", justifyContent: "space-between",
        borderBottom: "1px solid #0d1e2e" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <RadarMark size={40} />
          <div>
            <div style={{ fontFamily: "'Exo 2', sans-serif", fontWeight: 800,
              fontSize: 18, color: "#c8e8f8", letterSpacing: 3 }}>NEXRADAR</div>
            <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 9,
              color: "#1e3448", letterSpacing: 4 }}>PROFESSIONAL</div>
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <div style={{ width: 8, height: 8, borderRadius: "50%", background: "#00e676",
            animation: "blink 2s ease-in-out infinite" }} />
          <span style={{ color: "#1e3448", fontSize: 11,
            fontFamily: "'IBM Plex Mono', monospace", letterSpacing: 2 }}>
            SYSTEMS ONLINE
          </span>
        </div>
      </div>

      {/* Main content */}
      <div style={{ flex: 1, display: "flex", position: "relative", zIndex: 10 }}>

        {/* Left — branding panel */}
        <div style={{ flex: 1, display: "flex", flexDirection: "column",
          justifyContent: "center", padding: "60px 80px", maxWidth: 600 }}
          className="page-enter">

          {/* Hero */}
          <div style={{ marginBottom: 48 }}>
            <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 11,
              color: "#00d4e8", letterSpacing: 3, marginBottom: 16,
              display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ display: "inline-block", width: 20, height: 1, background: "#00d4e8" }} />
              ENTERPRISE TRADING INTELLIGENCE
            </div>
            <h1 style={{ fontFamily: "'Exo 2', sans-serif", fontWeight: 800,
              fontSize: "clamp(36px, 4vw, 56px)", color: "#c8e8f8", lineHeight: 1.1,
              marginBottom: 18 }}>
              Trade Smarter.<br />
              <span style={{ color: "#00d4e8" }}>Signal</span> Faster.
            </h1>
            <p style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 14,
              color: "#2e4558", lineHeight: 1.8, maxWidth: 420 }}>
              Real-time market intelligence with live WebSocket feeds, automated signal detection, and enterprise-grade portfolio analytics.
            </p>
          </div>

          {/* Feature list */}
          <FeaturesPanel />

          {/* Stats strip */}
          <div style={{ display: "flex", gap: 32, marginTop: 48, paddingTop: 32,
            borderTop: "1px solid #0d1e2e" }}>
            {[["50+","Watchlist slots"],["5","Signal strategies"],["Real-time","WebSocket feed"]].map(([val, lbl]) => (
              <div key={lbl}>
                <div style={{ fontFamily: "'Exo 2', sans-serif", fontWeight: 700,
                  fontSize: 22, color: "#00d4e8", marginBottom: 2 }}>{val}</div>
                <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 11,
                  color: "#1e3448", letterSpacing: 1 }}>{lbl}</div>
              </div>
            ))}
          </div>
        </div>

        {/* Right — auth card */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center",
          padding: "40px 60px", flex: "0 0 520px" }}>

          <div style={{
            width: "100%", maxWidth: 440,
            background: "#07101a",
            border: "1px solid #142030",
            borderRadius: 20,
            padding: "36px 36px 32px",
            animation: "glowPulse 4s ease-in-out infinite",
            position: "relative", overflow: "hidden",
          }}>
            {/* Card top glow line */}
            <div style={{ position: "absolute", top: 0, left: "10%", right: "10%",
              height: 1, background: "linear-gradient(90deg, transparent, #00d4e855, transparent)" }} />

            {/* Tab switcher */}
            <div style={{ display: "flex", borderBottom: "1px solid #0d1e2e", marginBottom: 28 }}>
              <button className={`tab-btn${mode === "signin" ? " active" : ""}`}
                onClick={() => switchMode("signin")}>SIGN IN</button>
              <button className={`tab-btn${mode === "signup" ? " active" : ""}`}
                onClick={() => switchMode("signup")}>SIGN UP</button>
            </div>

            {/* Welcome text */}
            <div style={{ marginBottom: 24 }}>
              <h2 style={{ fontFamily: "'Exo 2', sans-serif", fontWeight: 700,
                fontSize: 22, color: "#c8e8f8", marginBottom: 6 }}>
                {mode === "signin" ? "Welcome back" : "Create account"}
              </h2>
              <p style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 12,
                color: "#2e4558", lineHeight: 1.6 }}>
                {mode === "signin"
                  ? "Sign in to access your NexRadar Pro dashboard"
                  : "Join NexRadar Pro and start trading with edge"}
              </p>
            </div>

            {/* Form */}
            <div key={key}>
              {mode === "signin"
                ? <SignIn onSwitch={() => switchMode("signup")} onSuccess={onAuthenticated} supabase={supabase} />
                : <SignUp onSwitch={() => switchMode("signin")} onSuccess={onAuthenticated} supabase={supabase} />}
            </div>
          </div>
        </div>
      </div>

      {/* Footer */}
      <div style={{ position: "relative", zIndex: 10, padding: "16px 32px",
        borderTop: "1px solid #0d1e2e", display: "flex",
        justifyContent: "space-between", alignItems: "center" }}>
        <span style={{ color: "#1a2d3e", fontSize: 11,
          fontFamily: "'IBM Plex Mono', monospace", letterSpacing: 1 }}>
          © 2025 NexRadar Pro · nexradar.info
        </span>
        <div style={{ display: "flex", gap: 20 }}>
          {["Privacy","Terms","Support"].map(l => (
            <span key={l} style={{ color: "#1e3448", fontSize: 11,
              fontFamily: "'IBM Plex Mono', monospace", cursor: "pointer",
              transition: "color 0.2s" }}
              onMouseEnter={e => e.target.style.color = "#00d4e8"}
              onMouseLeave={e => e.target.style.color = "#1e3448"}>
              {l}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
