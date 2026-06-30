import React, { useEffect, useState } from "react";
import { motion } from "motion/react";
import {
  ArrowLeft,
  Check,
  ChevronDown,
  CircleAlert,
  Eye,
  EyeOff,
  Lock,
  Mail,
  Phone,
  Server,
  UserRound,
  Wifi
} from "lucide-react";
import { Badge } from "@/components/ui/badge";

const CLOUDFLARE_HKG_NODE = {
  label: "Cloudflare Hong Kong",
  code: "Cloudflare(HKG)",
  url: "https://inventory-cloudflare.wuchunkei.com/api",
  region: "Hong Kong"
};

const COUNTRY_CODES = [
  { code: "+86", flag: "CN", label: "China" },
  { code: "+852", flag: "HK", label: "Hong Kong" },
  { code: "+853", flag: "MO", label: "Macao" },
  { code: "+886", flag: "TW", label: "Taiwan" },
  { code: "+1", flag: "US", label: "United States / Canada" },
  { code: "+44", flag: "GB", label: "United Kingdom" },
  { code: "+65", flag: "SG", label: "Singapore" },
  { code: "+81", flag: "JP", label: "Japan" },
  { code: "+82", flag: "KR", label: "Korea, South" },
  { code: "+60", flag: "MY", label: "Malaysia" },
  { code: "+63", flag: "PH", label: "Philippines" },
  { code: "+66", flag: "TH", label: "Thailand" },
  { code: "+84", flag: "VN", label: "Vietnam" },
  { code: "+61", flag: "AU", label: "Australia" }
];

const AUTH_STORAGE_KEY = "pictureworks_inventory_web_auth";
const NODE_STORAGE_KEY = "pictureworks_inventory_web_api_base";

const STEPS = {
  EMPLOYEE: "employee",
  PASSWORD: "password",
  REGISTER: "register",
  RESET_VERIFY: "resetPasswordVerify",
  RESET_PASSWORD: "resetPassword",
  IT_CONTACT: "itContact",
  CHANGE_PASSWORD: "changePassword",
  SIGNED_IN: "signedIn"
};

function storedNodeUrl() {
  return CLOUDFLARE_HKG_NODE.url;
}

function nodeForUrl(url) {
  return url === CLOUDFLARE_HKG_NODE.url ? CLOUDFLARE_HKG_NODE : CLOUDFLARE_HKG_NODE;
}

function storedAuth() {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(AUTH_STORAGE_KEY) || "null");
    return parsed?.token ? parsed : null;
  } catch {
    return null;
  }
}

function saveAuth(session) {
  window.localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(session));
}

function clearAuth() {
  window.localStorage.removeItem(AUTH_STORAGE_KEY);
}

async function apiRequest(baseUrl, path, { method = "GET", body, token } = {}) {
  const response = await fetch(`${baseUrl.replace(/\/$/, "")}/${path.replace(/^\//, "")}`, {
    method,
    cache: "no-store",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {})
    },
    body: body ? JSON.stringify(body) : undefined
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.message || data.error || `Request failed with HTTP ${response.status}.`);
  }
  return data;
}

function roleLabel(role) {
  if (role === "warehouse_manager") return "Manager";
  if (role === "superadmin") return "Superadmin";
  if (role === "admin") return "Admin";
  return "Staff";
}

function validatePhone(digits, countryCode) {
  const trimmed = digits.trim();
  if (!trimmed) return null;
  if (countryCode === "+86" && trimmed.length !== 11) {
    return "China (+86) phone number must be exactly 11 digits.";
  }
  return null;
}

function LoginPage() {
  const [apiBaseUrl] = useState(storedNodeUrl);
  const [latencies, setLatencies] = useState({});
  const [isMeasuring, setIsMeasuring] = useState(false);
  const [session, setSession] = useState(storedAuth);
  const [step, setStep] = useState(() => (storedAuth() ? STEPS.SIGNED_IN : STEPS.EMPLOYEE));
  const [username, setUsername] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [currentPassword, setCurrentPassword] = useState("");
  const [phone, setPhone] = useState("");
  const [phoneCountryCode, setPhoneCountryCode] = useState("+86");
  const [nameInput, setNameInput] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [selectedRegion, setSelectedRegion] = useState("Hong Kong");
  const [selectedChinaContact, setSelectedChinaContact] = useState("Mark");

  const activeNode = nodeForUrl(apiBaseUrl);

  useEffect(() => {
    window.localStorage.setItem(NODE_STORAGE_KEY, CLOUDFLARE_HKG_NODE.url);
  }, []);

  useEffect(() => {
    measureNodes();
  }, []);

  async function measureNodes() {
    setIsMeasuring(true);
    const results = {};
    const node = CLOUDFLARE_HKG_NODE;
    const started = performance.now();
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 4500);
    try {
      const response = await fetch(`${node.url.replace(/\/$/, "")}/health`, {
        cache: "no-store",
        signal: controller.signal
      });
      results[node.label] = response.ok ? Math.round(performance.now() - started) : null;
    } catch {
      results[node.label] = null;
    } finally {
      window.clearTimeout(timeout);
    }
    setLatencies(results);
    setIsMeasuring(false);
  }

  const subtitle = {
    [STEPS.EMPLOYEE]: "Enter your employee ID to continue.",
    [STEPS.PASSWORD]: `Welcome back, ${displayName || username}!`,
    [STEPS.REGISTER]: "Verify your phone and set a password.",
    [STEPS.RESET_VERIFY]: "Verify your identity to reset your password.",
    [STEPS.RESET_PASSWORD]: "Identity verified. Set your new password.",
    [STEPS.IT_CONTACT]: "Please contact IT.",
    [STEPS.CHANGE_PASSWORD]: "Your password has expired. Set a new password to continue.",
    [STEPS.SIGNED_IN]: "You are signed in on this browser."
  }[step];

  const primaryTitle = {
    [STEPS.EMPLOYEE]: "Next",
    [STEPS.PASSWORD]: "Log in",
    [STEPS.REGISTER]: "Register",
    [STEPS.RESET_VERIFY]: "Verify",
    [STEPS.RESET_PASSWORD]: "Reset Password",
    [STEPS.CHANGE_PASSWORD]: "Save",
    [STEPS.IT_CONTACT]: "Back to login",
    [STEPS.SIGNED_IN]: "Refresh session"
  }[step];

  const canSubmit = (() => {
    if (step === STEPS.EMPLOYEE) return username.trim().length > 0;
    if (step === STEPS.RESET_VERIFY) return username.trim() && nameInput.trim() && phone.trim();
    if (step === STEPS.SIGNED_IN) return true;
    if (step === STEPS.CHANGE_PASSWORD) return currentPassword && newPasswordIsValid();
    return username.trim().length > 0;
  })();

  function newPasswordIsValid() {
    return password.length >= 8 && password === confirmPassword;
  }

  function resetSensitiveFields() {
    setPassword("");
    setConfirmPassword("");
    setCurrentPassword("");
    setNameInput("");
    setPhone("");
    setPhoneCountryCode("+86");
    setShowPassword(false);
  }

  async function finishAuth(authResponse) {
    const nextSession = {
      token: authResponse.token,
      expiresAt: authResponse.expiresAt,
      currentUser: authResponse.currentUser,
      apiBaseUrl,
      bootstrap: null
    };
    try {
      nextSession.bootstrap = await apiRequest(apiBaseUrl, "bootstrap", {
        token: authResponse.token
      });
    } catch {
      nextSession.bootstrap = null;
    }
    saveAuth(nextSession);
    setSession(nextSession);
    resetSensitiveFields();
    setErrorMessage("");
    setStep(authResponse.passwordExpired ? STEPS.CHANGE_PASSWORD : STEPS.SIGNED_IN);
  }

  async function submit() {
    if (step === STEPS.IT_CONTACT) {
      goBackToEmployee();
      return;
    }
    if (step === STEPS.SIGNED_IN) {
      setErrorMessage("");
      return;
    }
    if (!canSubmit || isSubmitting) return;

    setIsSubmitting(true);
    setErrorMessage("");
    try {
      if (step === STEPS.EMPLOYEE) {
        const trimmed = username.trim();
        const response = await apiRequest(apiBaseUrl, "login-start", {
          method: "POST",
          body: { username: trimmed }
        });
        setUsername(trimmed);
        setDisplayName(response.user?.name || "");
        setPhoneCountryCode(response.user?.phoneCountryCode || "+86");
        if (!response.exists) {
          setErrorMessage("Please contact IT.");
        } else if (response.hasPassword && !response.resetRequired) {
          setStep(STEPS.PASSWORD);
        } else {
          setStep(response.resetRequired ? STEPS.RESET_VERIFY : STEPS.REGISTER);
        }
      } else if (step === STEPS.PASSWORD) {
        const response = await apiRequest(apiBaseUrl, "login", {
          method: "POST",
          body: { username: username.trim(), password }
        });
        await finishAuth(response);
      } else if (step === STEPS.REGISTER) {
        const phoneError = validatePhone(phone, phoneCountryCode);
        if (phoneError) throw new Error(phoneError);
        const response = await apiRequest(apiBaseUrl, "register", {
          method: "POST",
          body: {
            username: username.trim(),
            password,
            confirmPassword,
            phone: phone.trim(),
            phoneCountryCode
          }
        });
        await finishAuth(response);
      } else if (step === STEPS.RESET_VERIFY) {
        await apiRequest(apiBaseUrl, "verify-identity", {
          method: "POST",
          body: {
            username: username.trim(),
            name: nameInput.trim(),
            phone: phone.trim()
          }
        });
        setStep(STEPS.RESET_PASSWORD);
      } else if (step === STEPS.RESET_PASSWORD) {
        const response = await apiRequest(apiBaseUrl, "reset-password", {
          method: "POST",
          body: {
            username: username.trim(),
            newPassword: password,
            confirmPassword,
            phone: phone.trim()
          }
        });
        await finishAuth(response);
      } else if (step === STEPS.CHANGE_PASSWORD) {
        await apiRequest(apiBaseUrl, "change-password", {
          method: "POST",
          token: session?.token,
          body: {
            currentPassword,
            newPassword: password,
            confirmPassword
          }
        });
        resetSensitiveFields();
        setStep(STEPS.SIGNED_IN);
      }
    } catch (error) {
      setErrorMessage(error.message || "Something went wrong.");
    } finally {
      setIsSubmitting(false);
    }
  }

  async function forgotPassword() {
    const trimmed = username.trim();
    if (!trimmed) {
      setErrorMessage("Enter your employee ID first.");
      return;
    }
    setUsername(trimmed);
    setErrorMessage("");
    resetSensitiveFields();
    setStep(STEPS.RESET_VERIFY);
    try {
      await apiRequest(apiBaseUrl, "forgot-password", {
        method: "POST",
        body: { username: trimmed }
      });
    } catch {
      // The iOS flow does not interrupt reset-password entry if this logging call fails.
    }
  }

  function goBackToEmployee() {
    setErrorMessage("");
    resetSensitiveFields();
    setDisplayName("");
    setStep(STEPS.EMPLOYEE);
  }

  function logout() {
    clearAuth();
    setSession(null);
    setUsername("");
    setDisplayName("");
    resetSensitiveFields();
    setStep(STEPS.EMPLOYEE);
    setErrorMessage("");
  }

  return (
    <main className="relative min-h-dvh overflow-hidden bg-black text-white">
      <LoginBackground />
      <LoginNavigation />
      <section className="relative z-10 mx-auto flex min-h-dvh w-full max-w-[430px] flex-col justify-center px-5 py-28 sm:py-32">
        <BackendNodeNavigation
          activeNode={activeNode}
          latencies={latencies}
          isMeasuring={isMeasuring}
          onMeasure={measureNodes}
        />

        <div className="mt-4">
          <motion.div
            initial={{ opacity: 0, y: 24, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
            className="glass-edge w-full rounded-[8px]"
          >
            <div className="relative overflow-hidden rounded-[8px] border border-white/10 bg-black/32 p-5 shadow-glass backdrop-blur-2xl">
              <div className="absolute inset-x-0 top-0 h-28 bg-gradient-to-b from-white/12 to-transparent" />
              <div className="relative space-y-6">
                {step === STEPS.IT_CONTACT ? (
                  <ITContactView
                    selectedRegion={selectedRegion}
                    selectedChinaContact={selectedChinaContact}
                    onRegion={setSelectedRegion}
                    onChinaContact={setSelectedChinaContact}
                    onBack={goBackToEmployee}
                  />
                ) : (
                  <>
                    <LoginTitle step={step} subtitle={subtitle} session={session} />
                    <div className="space-y-4">
                      <CredentialFields
                        step={step}
                        username={username}
                        setUsername={setUsername}
                        password={password}
                        setPassword={setPassword}
                        confirmPassword={confirmPassword}
                        setConfirmPassword={setConfirmPassword}
                        currentPassword={currentPassword}
                        setCurrentPassword={setCurrentPassword}
                        phone={phone}
                        setPhone={setPhone}
                        phoneCountryCode={phoneCountryCode}
                        setPhoneCountryCode={setPhoneCountryCode}
                        nameInput={nameInput}
                        setNameInput={setNameInput}
                        showPassword={showPassword}
                        setShowPassword={setShowPassword}
                        onSubmit={submit}
                        session={session}
                      />

                      {errorMessage && (
                        errorMessage === "Please contact IT." ? (
                          <button
                            type="button"
                            onClick={() => {
                              setErrorMessage("");
                              setStep(STEPS.IT_CONTACT);
                            }}
                            className="w-full text-center text-sm font-medium text-red-200 underline decoration-red-200/30 underline-offset-4"
                          >
                            Wrong employee ID, click here to contact IT
                          </button>
                        ) : (
                          <div className="rounded-[8px] border border-red-300/20 bg-red-300/10 p-3 text-center text-sm leading-5 text-red-100">
                            {errorMessage}
                          </div>
                        )
                      )}

                      <button
                        type="button"
                        onClick={submit}
                        disabled={isSubmitting || !canSubmit}
                        className="inline-flex h-12 w-full items-center justify-center rounded-full bg-white px-5 text-sm font-semibold text-black transition hover:bg-white/90 disabled:cursor-not-allowed disabled:bg-white/25 disabled:text-white/38"
                      >
                        {isSubmitting ? "Working..." : primaryTitle}
                      </button>

                      <SecondaryControls
                        step={step}
                        onWrongAccount={goBackToEmployee}
                        onForgotPassword={forgotPassword}
                        onLogout={logout}
                      />
                    </div>
                  </>
                )}
              </div>
            </div>
          </motion.div>
        </div>
      </section>
    </main>
  );
}

function LoginBackground() {
  return (
    <div className="absolute inset-0">
      <video
        className="h-full w-full object-cover opacity-45 saturate-[.78] contrast-125"
        autoPlay
        muted
        loop
        playsInline
      >
        <source src="/status-cinematic.mp4" type="video/mp4" />
        <source src="https://videos.pexels.com/video-files/7565437/7565437-uhd_2560_1440_25fps.mp4" type="video/mp4" />
      </video>
      <div className="absolute inset-0 bg-liquid-radial opacity-70 blur-3xl animate-drift" />
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_8%,rgba(255,255,255,.18),transparent_18%),linear-gradient(180deg,rgba(0,0,0,.04),#030303_86%)]" />
      <div className="absolute inset-0 bg-[linear-gradient(90deg,rgba(255,255,255,.035)_1px,transparent_1px),linear-gradient(rgba(255,255,255,.026)_1px,transparent_1px)] bg-[size:58px_58px] opacity-18" />
    </div>
  );
}

function LoginNavigation() {
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <header className="fixed inset-x-0 top-0 z-30 px-5 py-5 sm:px-8 lg:px-12">
      <div className="mx-auto flex max-w-7xl items-center justify-between rounded-full border border-white/10 bg-black/28 px-4 py-3 shadow-glass backdrop-blur-2xl">
        <a href="/" className="flex min-w-0 items-center gap-3">
          <span className="grid size-9 shrink-0 place-items-center rounded-full border border-white/14 bg-white/8">
            <img src="/pictureworks-status-icon.svg" alt="" className="size-8" />
          </span>
          <div className="min-w-0">
            <p className="truncate text-sm font-medium leading-none">Pictureworks Inventory</p>
            <p className="mt-1 text-xs text-white/46">Login Page</p>
          </div>
        </a>
        <nav className="hidden shrink-0 items-center gap-2 sm:flex">
          <a
            href="https://inventory-status.wuchunkei.com/"
            className="inline-flex h-9 items-center justify-center rounded-full border border-white/12 bg-white/[0.04] px-4 text-xs font-semibold text-white/72 transition hover:bg-white/10 hover:text-white"
          >
            Status
          </a>
          <a
            href="/"
            className="inline-flex h-9 items-center justify-center rounded-full bg-white px-4 text-xs font-semibold text-black transition hover:bg-white/90"
          >
            Home
          </a>
        </nav>
        <div className="relative sm:hidden">
          <button
            type="button"
            onClick={() => setMenuOpen((open) => !open)}
            aria-expanded={menuOpen}
            className="inline-flex h-9 items-center justify-center gap-2 rounded-full border border-white/12 bg-white/[0.04] px-4 text-xs font-semibold text-white/78 transition hover:bg-white/10 hover:text-white"
          >
            Menu
            <ChevronDown className={`size-3.5 transition-transform ${menuOpen ? "rotate-180" : ""}`} />
          </button>
          {menuOpen && (
            <div className="absolute right-0 top-12 w-40 rounded-[8px] border border-white/10 bg-black/72 p-2 shadow-glass backdrop-blur-2xl">
              <a
                href="https://inventory-status.wuchunkei.com/"
                className="flex h-10 items-center justify-center rounded-full border border-white/12 bg-white/[0.04] text-xs font-semibold text-white/76 transition hover:bg-white/10 hover:text-white"
              >
                Status
              </a>
              <a
                href="/"
                className="mt-2 flex h-10 items-center justify-center rounded-full bg-white text-xs font-semibold text-black transition hover:bg-white/90"
              >
                Home
              </a>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}

function BackendNodeNavigation({ activeNode, latencies, isMeasuring, onMeasure }) {
  const latency = latencies[activeNode.label];
  const latencyText = latency == null ? (isMeasuring ? "Calculating latency..." : "Latency timeout") : `${latency} ms latency`;

  return (
    <div className="mt-3 rounded-full border border-white/10 bg-black/32 px-3 py-2 shadow-glass backdrop-blur-2xl">
      <div className="flex min-h-11 items-center gap-3">
        <span className="grid size-9 shrink-0 place-items-center rounded-full border border-white/12 bg-white/8">
          <Server className="size-4 text-white/74" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium leading-none text-white">Cloudflare</p>
          <p className="mt-1.5 truncate text-[11px] leading-none text-white/42">{latencyText}</p>
        </div>
        <button
          type="button"
          onClick={onMeasure}
          className="grid size-9 shrink-0 place-items-center self-center rounded-full border border-white/10 bg-white/[0.04] text-white/62 transition hover:bg-white/10 hover:text-white"
          aria-label="Refresh server latency"
        >
          <Wifi className={`size-4 ${isMeasuring ? "animate-pulse" : ""}`} />
        </button>
      </div>
    </div>
  );
}

function LoginTitle({ step, subtitle, session }) {
  const isSignedIn = step === STEPS.SIGNED_IN;
  return (
    <div className="space-y-3">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="font-serif text-4xl leading-none tracking-normal">
            {isSignedIn ? "Inventory" : step === STEPS.CHANGE_PASSWORD ? "Change Password" : "Inventory"}
          </p>
          <p className="mt-3 text-sm leading-6 text-white/52">{subtitle}</p>
        </div>
        <span className="grid size-11 shrink-0 place-items-center rounded-full border border-white/12 bg-white/8">
          {isSignedIn ? <Check className="size-5 text-emerald-200" /> : <Lock className="size-5 text-white/74" />}
        </span>
      </div>
      {isSignedIn && session?.currentUser && (
        <div className="liquid-sheen rounded-[8px] border border-white/10 p-4">
          <p className="text-sm text-white/46">Signed in as</p>
          <p className="mt-1 text-xl font-semibold">{session.currentUser.name}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Badge variant="success">{session.currentUser.username}</Badge>
            <Badge>{roleLabel(session.currentUser.role)}</Badge>
          </div>
          <p className="mt-3 text-xs leading-5 text-white/42">
            Session expires {session.expiresAt ? new Date(session.expiresAt).toLocaleString() : "later"}.
          </p>
        </div>
      )}
    </div>
  );
}

function CredentialFields(props) {
  const {
    step,
    username,
    setUsername,
    password,
    setPassword,
    confirmPassword,
    setConfirmPassword,
    currentPassword,
    setCurrentPassword,
    phone,
    setPhone,
    phoneCountryCode,
    setPhoneCountryCode,
    nameInput,
    setNameInput,
    showPassword,
    setShowPassword,
    onSubmit
  } = props;

  if (step === STEPS.SIGNED_IN) return null;

  return (
    <div className="space-y-3">
      {step === STEPS.EMPLOYEE && (
        <TextInput
          icon={UserRound}
          label="Employee ID"
          value={username}
          autoComplete="username"
          onChange={(value) => setUsername(value)}
          onSubmit={onSubmit}
        />
      )}

      {[STEPS.PASSWORD, STEPS.REGISTER, STEPS.RESET_VERIFY].includes(step) && (
        <TextInput
          icon={UserRound}
          label="Employee ID"
          value={username}
          readOnly
          onChange={() => {}}
        />
      )}

      {step === STEPS.CHANGE_PASSWORD && (
        <PasswordInput
          label="Current password"
          value={currentPassword}
          showPassword={showPassword}
          setShowPassword={setShowPassword}
          onChange={setCurrentPassword}
          onSubmit={onSubmit}
        />
      )}

      {[STEPS.PASSWORD, STEPS.REGISTER, STEPS.RESET_PASSWORD, STEPS.CHANGE_PASSWORD].includes(step) && (
        <PasswordInput
          label={step === STEPS.PASSWORD ? "Password" : step === STEPS.CHANGE_PASSWORD ? "New password (min 8 characters)" : "Password"}
          value={password}
          showPassword={showPassword}
          setShowPassword={setShowPassword}
          onChange={setPassword}
          onSubmit={onSubmit}
        />
      )}

      {[STEPS.REGISTER, STEPS.RESET_PASSWORD, STEPS.CHANGE_PASSWORD].includes(step) && (
        <PasswordInput
          label="Confirm password"
          value={confirmPassword}
          showPassword={showPassword}
          setShowPassword={setShowPassword}
          onChange={setConfirmPassword}
          onSubmit={onSubmit}
        />
      )}

      {step === STEPS.RESET_VERIFY && (
        <TextInput
          icon={UserRound}
          label="Full name"
          value={nameInput}
          autoComplete="name"
          onChange={setNameInput}
          onSubmit={onSubmit}
        />
      )}

      {[STEPS.REGISTER, STEPS.RESET_VERIFY].includes(step) && (
        <PhoneInput
          value={phone}
          countryCode={phoneCountryCode}
          onCountryCode={setPhoneCountryCode}
          onChange={setPhone}
          onSubmit={onSubmit}
        />
      )}
    </div>
  );
}

function TextInput({ icon: Icon, label, value, onChange, onSubmit, readOnly = false, autoComplete }) {
  return (
    <label className="block">
      <span className="sr-only">{label}</span>
      <div className={`flex h-12 items-center gap-3 border-b px-1 ${
        readOnly ? "border-white/14 text-white/42" : "border-white/24 text-white"
      }`}>
        <Icon className="size-4 shrink-0 text-white/44" />
        <input
          value={value}
          readOnly={readOnly}
          autoComplete={autoComplete}
          placeholder={label}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") onSubmit?.();
          }}
          className="h-full min-w-0 flex-1 bg-transparent text-base outline-none placeholder:text-white/35"
        />
      </div>
    </label>
  );
}

function PasswordInput({ label, value, onChange, onSubmit, showPassword, setShowPassword }) {
  return (
    <label className="block">
      <span className="sr-only">{label}</span>
      <div className="flex h-12 items-center gap-3 border-b border-white/24 px-1 text-white">
        <Lock className="size-4 shrink-0 text-white/44" />
        <input
          value={value}
          type={showPassword ? "text" : "password"}
          autoComplete="current-password"
          placeholder={label}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") onSubmit?.();
          }}
          className="h-full min-w-0 flex-1 bg-transparent text-base outline-none placeholder:text-white/35"
        />
        <button
          type="button"
          onClick={() => setShowPassword(!showPassword)}
          className="grid size-8 place-items-center rounded-full text-white/48"
          aria-label={showPassword ? "Hide password" : "Show password"}
        >
          {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
        </button>
      </div>
    </label>
  );
}

function PhoneInput({ value, countryCode, onCountryCode, onChange, onSubmit }) {
  return (
    <label className="block">
      <span className="sr-only">Phone</span>
      <div className="flex h-12 items-center gap-2 border-b border-white/24 px-1 text-white">
        <Phone className="size-4 shrink-0 text-white/44" />
        <select
          value={countryCode}
          onChange={(event) => onCountryCode(event.target.value)}
          className="max-w-[104px] bg-transparent text-sm outline-none"
          aria-label="Country code"
        >
          {COUNTRY_CODES.map((country) => (
            <option key={`${country.code}-${country.label}`} value={country.code} className="bg-neutral-950 text-white">
              {country.flag} {country.code}
            </option>
          ))}
        </select>
        <input
          value={value}
          inputMode="numeric"
          autoComplete="tel-national"
          placeholder="Phone"
          onChange={(event) => onChange(event.target.value.replace(/\D/g, ""))}
          onKeyDown={(event) => {
            if (event.key === "Enter") onSubmit?.();
          }}
          className="h-full min-w-0 flex-1 bg-transparent text-base outline-none placeholder:text-white/35"
        />
      </div>
    </label>
  );
}

function SecondaryControls({ step, onWrongAccount, onForgotPassword, onLogout }) {
  if (step === STEPS.SIGNED_IN) {
    return (
      <button type="button" onClick={onLogout} className="w-full text-center text-sm text-white/54">
        Log out
      </button>
    );
  }
  if (step === STEPS.CHANGE_PASSWORD) return null;
  if (step === STEPS.EMPLOYEE) {
    return (
      <button type="button" onClick={onForgotPassword} className="w-full text-center text-sm font-medium text-red-200">
        Forgot Password &gt;
      </button>
    );
  }
  return (
    <div className="flex items-center justify-between gap-4 text-sm">
      <button type="button" onClick={onWrongAccount} className="inline-flex items-center gap-1 text-white/54">
        <ArrowLeft className="size-3.5" />
        Wrong Account
      </button>
      {[STEPS.PASSWORD].includes(step) && (
        <button type="button" onClick={onForgotPassword} className="font-medium text-red-200">
          Forgot Password &gt;
        </button>
      )}
    </div>
  );
}

function ITContactView({ selectedRegion, selectedChinaContact, onRegion, onChinaContact, onBack }) {
  const contact = (() => {
    if (selectedRegion === "China" && selectedChinaContact === "Mark") {
      return { name: "Mark Gao", email: "mark.gao@pictureworks.com", phone: "+86 136 6100 8218" };
    }
    return { name: "John Hu", email: "john.hu@pictureworks.com", phone: "+852 5262 9698" };
  })();

  return (
    <div className="space-y-5">
      <div className="text-center">
        <div className="mx-auto grid size-12 place-items-center rounded-full border border-red-200/20 bg-red-300/10">
          <CircleAlert className="size-5 text-red-100" />
        </div>
        <h1 className="mt-4 text-2xl font-semibold">IT Contact Information</h1>
        <p className="mt-2 text-sm text-white/52">Please contact IT.</p>
      </div>

      <div className="grid grid-cols-3 rounded-full border border-white/10 bg-white/[0.04] p-1 text-sm">
        {["China", "Hong Kong", "Macao"].map((region) => (
          <button
            key={region}
            type="button"
            onClick={() => onRegion(region)}
            className={`h-9 rounded-full font-medium transition ${
              selectedRegion === region ? "bg-white text-black" : "text-white/54"
            }`}
          >
            {region}
          </button>
        ))}
      </div>

      {selectedRegion === "China" && (
        <div className="grid grid-cols-2 rounded-full border border-white/10 bg-white/[0.04] p-1 text-sm">
          {["Mark", "John"].map((name) => (
            <button
              key={name}
              type="button"
              onClick={() => onChinaContact(name)}
              className={`h-9 rounded-full font-medium transition ${
                selectedChinaContact === name ? "bg-white text-black" : "text-white/54"
              }`}
            >
              {name}
            </button>
          ))}
        </div>
      )}

      <div className="liquid-sheen rounded-[8px] border border-white/10 p-4">
        <p className="text-lg font-semibold">{contact.name}</p>
        <a href={`mailto:${contact.email}`} className="mt-3 flex items-center gap-2 text-sm text-white/64">
          <Mail className="size-4" />
          {contact.email}
        </a>
        <a href={`tel:${contact.phone.replace(/[^\d+]/g, "")}`} className="mt-3 flex items-center gap-2 text-sm text-white/64">
          <Phone className="size-4" />
          {contact.phone}
        </a>
      </div>

      <button
        type="button"
        onClick={onBack}
        className="inline-flex h-12 w-full items-center justify-center rounded-full border border-white/12 bg-white/[0.04] text-sm font-semibold text-white/76"
      >
        Back to login.
      </button>
    </div>
  );
}

export default LoginPage;
