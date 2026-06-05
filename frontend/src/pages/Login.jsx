import React, { useState, useCallback, useEffect, useRef } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Mail, Lock, UserCircle2, Stethoscope, ArrowLeft, AlertCircle } from "lucide-react";
import { useAuth } from "../context/AuthContext";
import axios from "axios";
import { BACKEND_URL } from "../utils";

const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID;

let googleScriptPromise;

const loadGoogleScript = () => {
  if (window.google?.accounts?.id) {
    return Promise.resolve();
  }

  if (!googleScriptPromise) {
    googleScriptPromise = new Promise((resolve, reject) => {
      const existingScript = document.querySelector("script[src='https://accounts.google.com/gsi/client']");
      if (existingScript) {
        existingScript.addEventListener("load", resolve, { once: true });
        existingScript.addEventListener("error", reject, { once: true });
        return;
      }

      const script = document.createElement("script");
      script.src = "https://accounts.google.com/gsi/client";
      script.async = true;
      script.defer = true;
      script.onload = resolve;
      script.onerror = reject;
      document.body.appendChild(script);
    });
  }

  return googleScriptPromise;
};

const AuthDivider = () => (
  <div className="flex items-center gap-3">
    <div className="h-px flex-1 bg-gray-200" />
    <span className="text-xs font-medium uppercase tracking-wide text-gray-400">or</span>
    <div className="h-px flex-1 bg-gray-200" />
  </div>
);

const GoogleSigninButton = ({ disabled, onCredential, userType }) => {
  const buttonRef = useRef(null);

  useEffect(() => {
    if (!GOOGLE_CLIENT_ID || !buttonRef.current) {
      return;
    }

    let isMounted = true;

    loadGoogleScript()
      .then(() => {
        if (!isMounted || !buttonRef.current) {
          return;
        }

        window.google.accounts.id.initialize({
          client_id: GOOGLE_CLIENT_ID,
          callback: onCredential,
        });
        buttonRef.current.innerHTML = "";
        window.google.accounts.id.renderButton(buttonRef.current, {
          theme: "outline",
          size: "large",
          text: "signin_with",
          shape: "rectangular",
          width: buttonRef.current.offsetWidth || 320,
        });
      })
      .catch(() => {});

    return () => {
      isMounted = false;
    };
  }, [onCredential]);

  if (!GOOGLE_CLIENT_ID) {
    return (
      <p className="text-sm text-center text-amber-700 bg-amber-50 border border-amber-200 rounded-lg p-3">
        Add VITE_GOOGLE_CLIENT_ID to frontend/.env to enable Google sign in.
      </p>
    );
  }

  return (
    <div className={disabled ? "pointer-events-none opacity-60" : ""}>
      <div
        ref={buttonRef}
        aria-label={`Sign in as ${userType} with Google`}
        className="flex justify-center min-h-[44px]"
      />
    </div>
  );
};

const ProfileSelection = ({ setUserType }) => (
  <div className="space-y-8">
    <div className="text-center">
      <h3 className="text-xl font-semibold text-gray-800">Choose your profile type</h3>
      <p className="mt-2 text-gray-600">
        Select how you want to sign in to MediPulse
      </p>
    </div>
    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
      <button
        onClick={() => setUserType("user")}
        className="flex flex-col items-center p-6 border-2 border-gray-200 rounded-xl hover:border-blue-500 hover:bg-blue-50 transition-all duration-200 shadow-sm hover:shadow"
      >
        <div className="bg-blue-100 p-4 rounded-full">
          <UserCircle2 className="h-10 w-10 text-blue-600" />
        </div>
        <h4 className="mt-4 text-lg font-medium text-gray-800">Sign in as User</h4>
        <p className="mt-2 text-center text-sm text-gray-600">
          Access your healthcare network and communities
        </p>
      </button>
      <button
        onClick={() => setUserType("doctor")}
        className="flex flex-col items-center p-6 border-2 border-gray-200 rounded-xl hover:border-blue-500 hover:bg-blue-50 transition-all duration-200 shadow-sm hover:shadow"
      >
        <div className="bg-blue-100 p-4 rounded-full">
          <Stethoscope className="h-10 w-10 text-blue-600" />
        </div>
        <h4 className="mt-4 text-lg font-medium text-gray-800">Sign in as Doctor</h4>
        <p className="mt-2 text-center text-sm text-gray-600">
          Manage your practice and patient care
        </p>
      </button>
    </div>
  </div>
);

const LoginForm = ({ handleSubmit, handleGoogleSignin, message, email, setEmail, password, setPassword, rememberMe, setRememberMe, loading, userType, onForgotPassword }) => (
  <form className="space-y-6" onSubmit={handleSubmit}>
    {message && (
      <div className="bg-red-50 border-l-4 border-red-500 p-4 rounded-md flex items-start">
        <AlertCircle className="h-5 w-5 text-red-500 mr-3 flex-shrink-0 mt-0.5" />
        <p className="text-sm text-red-700">{message}</p>
      </div>
    )}
    
    <div className="space-y-4">
      <div>
        <label htmlFor="email-address" className="block text-sm font-medium text-gray-700 mb-1">
          Email address
        </label>
        <div className="relative">
          <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
            <Mail className="h-5 w-5 text-gray-400" />
          </div>
          <input
            id="email-address"
            name="email"
            type="email"
            autoComplete="email"
            required
            onChange={(e) => setEmail(e.target.value)}
            value={email}
            disabled={loading}
            className="appearance-none block w-full px-3 py-3 pl-10 border border-gray-300 rounded-lg shadow-sm placeholder-gray-400 focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm transition-colors"
            placeholder="you@example.com"
          />
        </div>
      </div>
      
      <div>
        <label htmlFor="password" className="block text-sm font-medium text-gray-700 mb-1">
          Password
        </label>
        <div className="relative">
          <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
            <Lock className="h-5 w-5 text-gray-400" />
          </div>
          <input
            id="password"
            name="password"
            type="password"
            autoComplete="current-password"
            required
            onChange={(e) => setPassword(e.target.value)}
            value={password}
            disabled={loading}
            className="appearance-none block w-full px-3 py-3 pl-10 border border-gray-300 rounded-lg shadow-sm placeholder-gray-400 focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm transition-colors"
            placeholder="••••••••"
          />
        </div>
      </div>
    </div>
    
    <div className="flex items-center justify-between">
      <div className="flex items-center">
        <input
          id="remember-me"
          name="remember-me"
          type="checkbox"
          checked={rememberMe}
          onChange={(e) => setRememberMe(e.target.checked)}
          className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
        />
        <label
          htmlFor="remember-me"
          className="ml-2 block text-sm text-gray-700"
        >
          Remember me
        </label>
      </div>
      <div className="text-sm">
        <button
          type="button"
          onClick={onForgotPassword}
          className="font-medium text-blue-600 hover:text-blue-500 transition-colors"
        >
          Forgot password?
        </button>
      </div>
    </div>
    
    <div>
      <button
        type="submit"
        disabled={loading}
        className={`relative w-full flex justify-center py-3 px-4 border border-transparent text-sm font-medium rounded-lg text-white bg-blue-600 ${loading ? 'opacity-70 cursor-not-allowed' : 'hover:bg-blue-700'} shadow-sm focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 transition-colors`}
      >
        {loading ? 'Signing in...' : `Sign in as ${userType === 'user' ? 'User' : 'Doctor'}`}
      </button>
    </div>
    <AuthDivider />
    <GoogleSigninButton
      disabled={loading}
      onCredential={handleGoogleSignin}
      userType={userType}
    />
  </form>
);

const ForgotPasswordForm = ({
  email,
  setEmail,
  otp,
  setOtp,
  newPassword,
  setNewPassword,
  message,
  loading,
  otpSent,
  onSendOtp,
  onResetPassword,
  onBack,
  userType,
}) => (
  <form className="space-y-5" onSubmit={otpSent ? onResetPassword : onSendOtp}>
    {message && (
      <div className="bg-red-50 border-l-4 border-red-500 p-4 rounded-md flex items-start">
        <AlertCircle className="h-5 w-5 text-red-500 mr-3 flex-shrink-0 mt-0.5" />
        <p className="text-sm text-red-700">{message}</p>
      </div>
    )}

    <div>
      <label htmlFor="reset-email" className="block text-sm font-medium text-gray-700 mb-1">
        Email address
      </label>
      <input
        id="reset-email"
        type="email"
        required
        value={email}
        disabled={loading || otpSent}
        onChange={(event) => setEmail(event.target.value)}
        className="block w-full rounded-lg border border-gray-300 px-3 py-3 text-sm shadow-sm focus:border-blue-500 focus:outline-none"
        placeholder="you@example.com"
      />
    </div>

    {otpSent && (
      <>
        <div>
          <label htmlFor="reset-otp" className="block text-sm font-medium text-gray-700 mb-1">
            Email OTP
          </label>
          <input
            id="reset-otp"
            inputMode="numeric"
            required
            value={otp}
            disabled={loading}
            onChange={(event) => setOtp(event.target.value.replace(/\D/g, "").slice(0, 6))}
            className="block w-full rounded-lg border border-gray-300 px-3 py-3 text-sm shadow-sm focus:border-blue-500 focus:outline-none"
            placeholder="Enter 6 digit OTP"
          />
        </div>
        <div>
          <label htmlFor="new-password" className="block text-sm font-medium text-gray-700 mb-1">
            New password
          </label>
          <input
            id="new-password"
            type="password"
            required
            minLength={8}
            value={newPassword}
            disabled={loading}
            onChange={(event) => setNewPassword(event.target.value)}
            className="block w-full rounded-lg border border-gray-300 px-3 py-3 text-sm shadow-sm focus:border-blue-500 focus:outline-none"
            placeholder="At least 8 characters"
          />
        </div>
      </>
    )}

    <button
      type="submit"
      disabled={loading}
      className={`w-full rounded-lg bg-blue-600 px-4 py-3 text-sm font-medium text-white ${loading ? "cursor-not-allowed opacity-70" : "hover:bg-blue-700"}`}
    >
      {loading ? "Processing..." : otpSent ? "Reset password" : `Send OTP as ${userType === "user" ? "User" : "Doctor"}`}
    </button>
    <button
      type="button"
      onClick={onBack}
      className="flex w-full items-center justify-center py-2 text-sm font-medium text-gray-600 hover:text-blue-600"
    >
      <ArrowLeft className="mr-2 h-4 w-4" />
      Back to sign in
    </button>
  </form>
);

const Login = () => {
  const [userType, setUserType] = useState("select");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [rememberMe, setRememberMe] = useState(false);
  const [authMode, setAuthMode] = useState("login");
  const [resetOtp, setResetOtp] = useState("");
  const [resetOtpSent, setResetOtpSent] = useState(false);
  const [newPassword, setNewPassword] = useState("");
  const { isAuth, setIsAuth, setUser, setRole } = useAuth();
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    if(isAuth){
      navigate("/dashboard");
    }
  },[isAuth, navigate]);

  const handleSubmit = useCallback(async (e) => {
    e.preventDefault();
    setMessage("");
    setLoading(true);
    try {
      const res = await axios.post(
        `${BACKEND_URL}/${userType}/login`,
        { email, password, rememberMe },
        { withCredentials: true, headers: { "Content-Type": "application/json" } }
      );
      if (res.status === 201) {
        setIsAuth(true);
        setUser(res.data.result);
        setRole(userType);
        navigate("/dashboard");
      } else {
        setMessage(res.data.message || "Login failed. Please check your credentials.");
      }
    } catch (err) {
      console.error(err);
      if (err.response?.data?.message) {
        setMessage(err.response.data.message);
      } else {
        setMessage("Login failed. Please check your credentials or try again later.");
      }
    }
    setLoading(false);
  }, [email, password, rememberMe, userType, navigate, setIsAuth, setUser, setRole]);

  const handleGoogleSignin = useCallback(async (response) => {
    setMessage("");

    if (!response?.credential) {
      setMessage("Google sign in did not return a valid credential");
      return;
    }

    setLoading(true);
    try {
      const res = await axios.post(
        `${BACKEND_URL}/${userType}/google-auth`,
        { credential: response.credential, role: userType, rememberMe },
        { withCredentials: true, headers: { "Content-Type": "application/json" } }
      );

      if (res.status === 201) {
        setIsAuth(true);
        setUser(res.data.result);
        setRole(res.data.role || userType);
        navigate("/dashboard");
      } else {
        setMessage(res.data.message || "Google sign in failed");
      }
    } catch (err) {
      console.error(err);
      const backendUrlText = BACKEND_URL || "backend URL missing";
      setMessage(
        err.response?.data?.message ||
          `Google sign in failed. Backend: ${backendUrlText}. ${err.message || "Please try again."}`
      );
    }
    setLoading(false);
  }, [rememberMe, userType, navigate, setIsAuth, setUser, setRole]);

  const sendForgotPasswordOtp = useCallback(async (e) => {
    e.preventDefault();
    setMessage("");
    setLoading(true);
    try {
      const res = await axios.post(
        `${BACKEND_URL}/${userType}/forgot-password/send-otp`,
        { email },
        { headers: { "Content-Type": "application/json" } }
      );
      setResetOtpSent(true);
      setMessage(res.data.message || "OTP sent to your email");
    } catch (err) {
      setMessage(err.response?.data?.message || "Unable to send OTP. Please try again.");
    }
    setLoading(false);
  }, [email, userType]);

  const resetPassword = useCallback(async (e) => {
    e.preventDefault();
    setMessage("");
    setLoading(true);
    try {
      const res = await axios.post(
        `${BACKEND_URL}/${userType}/forgot-password/reset`,
        { email, otp: resetOtp, newPassword },
        { headers: { "Content-Type": "application/json" } }
      );
      setMessage(res.data.message || "Password reset successfully. Please sign in.");
      setAuthMode("login");
      setResetOtp("");
      setResetOtpSent(false);
      setNewPassword("");
      setPassword("");
    } catch (err) {
      setMessage(err.response?.data?.message || "Unable to reset password. Please try again.");
    }
    setLoading(false);
  }, [email, newPassword, resetOtp, userType]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-gray-50 to-blue-50 py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-md w-full bg-white p-8 sm:p-10 rounded-2xl shadow-md border border-gray-100">
        <div className="mb-10 text-center">
          <h2 className="text-3xl font-extrabold text-gray-900 tracking-tight">
            {userType === "select" ? "Welcome Back" : `Sign in as ${userType === 'user' ? 'User' : 'Doctor'}`}
          </h2>
          <p className="mt-3 text-gray-600">
            Don't have an account?{" "}
            <Link
              to="/signup"
              className="font-medium text-blue-600 hover:text-blue-500 transition-colors"
            >
              Sign up here
            </Link>
          </p>
        </div>
        
        {userType === "select" ? (
          <ProfileSelection setUserType={setUserType} />
        ) : authMode === "forgot" ? (
          <ForgotPasswordForm
            email={email}
            setEmail={setEmail}
            otp={resetOtp}
            setOtp={setResetOtp}
            newPassword={newPassword}
            setNewPassword={setNewPassword}
            message={message}
            loading={loading}
            otpSent={resetOtpSent}
            onSendOtp={sendForgotPasswordOtp}
            onResetPassword={resetPassword}
            onBack={() => {
              setAuthMode("login");
              setMessage("");
              setResetOtp("");
              setResetOtpSent(false);
              setNewPassword("");
            }}
            userType={userType}
          />
        ) : (
          <>
            <LoginForm 
              handleSubmit={handleSubmit}
              message={message}
              email={email}
              setEmail={setEmail}
              password={password}
              setPassword={setPassword}
              rememberMe={rememberMe}
              setRememberMe={setRememberMe}
              handleGoogleSignin={handleGoogleSignin}
              loading={loading}
              userType={userType}
              onForgotPassword={() => {
                setAuthMode("forgot");
                setMessage("");
              }}
            />
            
            <button
              onClick={() => {
                setUserType("select");
                setAuthMode("login");
                setMessage("");
              }}
              className="mt-6 flex items-center justify-center w-full text-sm text-gray-600 hover:text-blue-600 py-2 transition-colors font-medium"
            >
              <ArrowLeft className="h-4 w-4 mr-2" />
              Change profile type
            </button>
          </>
        )}
        <div className="mt-8 pt-6 border-t border-gray-200">
          <p className="text-xs text-center text-gray-500">
            By continuing, you agree to MediPulse's <a href="#" className="text-blue-600 hover:underline">Terms of Service</a> and <a href="#" className="text-blue-600 hover:underline">Privacy Policy</a>.
          </p>
        </div>
      </div>
    </div>
  );
};

export default Login;
