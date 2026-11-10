"use client";
import React, { useState } from "react";
import { useRouter } from "next/navigation";
import { authService } from "@/lib/auth";

export default function LoginPage() {
  const router = useRouter();
  const [identifier, setIdentifier] = useState("admin@institution.edu");
  const [password, setPassword] = useState("password123");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  // Mandatory First-Login Password Change state
  const [showPasswordChange, setShowPasswordChange] = useState(false);
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [activeUsername, setActiveUsername] = useState("");

  const [notice, setNotice] = useState(null);

  React.useEffect(() => {
    if (typeof window !== "undefined") {
      const from = new URLSearchParams(window.location.search).get("from");
      if (from) {
        setNotice("This route is protected. Please sign in to access the ERP panel.");
      }
    }
  }, []);

  const handleLogin = async (e) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      const isEmail = identifier.includes("@");
      const res = await authService.login({
        email: isEmail ? identifier : undefined,
        username: !isEmail ? identifier : undefined,
        password: password
      });

      const from = typeof window !== "undefined" && new URLSearchParams(window.location.search).get("from");
      // Students go to their portal; staff go back to the page they asked for.
      const home = res?.home || "/admin";
      const target = from && from.startsWith(home) ? from : home;

      if (res?.mustChangePassword) {
        setActiveUsername(res.user?.username || identifier);
        setShowPasswordChange(true);
      } else {
        router.push(target);
      }
    } catch (err) {
      setError(err.message || "Invalid credentials. Please verify your login credentials.");
    } finally {
      setLoading(false);
    }
  };

  const handlePasswordChangeSubmit = async (e) => {
    e.preventDefault();
    if (newPassword !== confirmPassword) {
      setError("New passwords do not match.");
      return;
    }
    if (newPassword.length < 8 || !/[A-Za-z]/.test(newPassword) || !/[0-9]/.test(newPassword)) {
      setError("Use at least 8 characters with at least one letter and one number.");
      return;
    }

    try {
      setLoading(true);
      const changed = await authService.changePassword({
        username: activeUsername,
        currentPassword: password,
        newPassword: newPassword
      });
      setShowPasswordChange(false);
      router.push(changed?.home || "/admin");
    } catch (err) {
      setError(err.message || "Failed to update password.");
    } finally {
      setLoading(false);
    }
  };

  const fillQuickCredentials = (userIdent, pass) => {
    setIdentifier(userIdent);
    setPassword(pass);
    setError(null);
  };

  return (
    <div className="min-h-screen bg-slate-900 flex flex-col justify-center py-12 sm:px-6 lg:px-8 relative overflow-hidden">
      {/* Background glow effects */}
      <div className="absolute top-1/4 left-1/2 -translate-x-1/2 -translate-y-1/2 w-96 h-96 bg-blue-600/20 rounded-full blur-3xl pointer-events-none"></div>
      <div className="absolute bottom-10 right-10 w-80 h-80 bg-indigo-600/20 rounded-full blur-3xl pointer-events-none"></div>

      <div className="sm:mx-auto sm:w-full sm:max-w-md relative z-10">
        <div className="flex justify-center mb-3">
          <div className="w-12 h-12 rounded-xl bg-gradient-to-tr from-blue-600 to-indigo-500 flex items-center justify-center text-white text-2xl font-black shadow-lg shadow-blue-500/30">
            E
          </div>
        </div>
        <h2 className="text-center text-2xl font-extrabold text-white tracking-tight">
          NextGen Institutional ERP
        </h2>
        <p className="mt-1 text-center text-xs text-slate-400">
          Modular Central Communication Hub & Multi-Tenant Portal
        </p>
      </div>

      <div className="mt-8 sm:mx-auto sm:w-full sm:max-w-md relative z-10 px-4 sm:px-0">
        <div className="bg-slate-800/80 backdrop-blur-xl py-8 px-6 shadow-2xl rounded-2xl border border-slate-700/80 sm:px-10">
          
          {notice && (
            <div className="mb-4 p-3 rounded-lg text-xs bg-amber-500/10 border border-amber-500/30 text-amber-300 font-medium flex items-start gap-2">
              <span>🔒</span>
              <div>{notice}</div>
            </div>
          )}

          {error && (
            <div className="mb-4 p-3 rounded-lg text-xs bg-rose-500/10 border border-rose-500/30 text-rose-400 font-medium flex items-start gap-2">
              <span>⚠️</span>
              <div>{error}</div>
            </div>
          )}

          {!showPasswordChange ? (
            <form className="space-y-4" onSubmit={handleLogin}>
              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">
                  Username or Institutional Email
                </label>
                <input
                  type="text"
                  required
                  value={identifier}
                  onChange={(e) => setIdentifier(e.target.value)}
                  placeholder="e.g. admin@demo.edu or tchr.rafiqul"
                  className="w-full px-3.5 py-2.5 bg-slate-900/70 border border-slate-600 rounded-xl text-white text-xs placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all"
                />
              </div>

              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="block text-xs font-medium text-slate-300">
                    Password
                  </label>
                  <span className="text-[11px] text-blue-400 hover:underline cursor-pointer">
                    Forgot password?
                  </span>
                </div>
                <input
                  type="password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••••••"
                  className="w-full px-3.5 py-2.5 bg-slate-900/70 border border-slate-600 rounded-xl text-white text-xs placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all"
                />
              </div>

              <div className="flex items-center justify-between text-xs text-slate-400">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" defaultChecked className="rounded border-slate-700 text-blue-600 focus:ring-blue-500" />
                  <span>Remember session</span>
                </label>
                <span className="text-[10px] text-slate-500">RLS Tenant: inst-001</span>
              </div>

              <button
                type="submit"
                disabled={loading}
                className="w-full py-2.5 px-4 rounded-xl text-xs font-semibold text-white bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 shadow-lg shadow-blue-500/25 transition-all disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {loading ? (
                  <>
                    <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                    Authenticating with Core ERP...
                  </>
                ) : (
                  "Sign In to ERP Portal"
                )}
              </button>
            </form>
          ) : (
            <form className="space-y-4" onSubmit={handlePasswordChangeSubmit}>
              <div className="p-3 bg-amber-500/10 border border-amber-500/30 rounded-xl text-amber-300 text-xs">
                🔒 <strong>First-Login Security Policy:</strong> You must update your temporary password before accessing the system.
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">
                  New Secure Password
                </label>
                <input
                  type="password"
                  required
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder="At least 8 characters"
                  className="w-full px-3.5 py-2.5 bg-slate-900/70 border border-slate-600 rounded-xl text-white text-xs focus:ring-2 focus:ring-blue-500 focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">
                  Confirm New Password
                </label>
                <input
                  type="password"
                  required
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="Re-enter password"
                  className="w-full px-3.5 py-2.5 bg-slate-900/70 border border-slate-600 rounded-xl text-white text-xs focus:ring-2 focus:ring-blue-500 focus:outline-none"
                />
              </div>

              <button
                type="submit"
                disabled={loading}
                className="w-full py-2.5 px-4 rounded-xl text-xs font-semibold text-white bg-emerald-600 hover:bg-emerald-500 transition-all flex items-center justify-center gap-2"
              >
                {loading ? "Updating Password..." : "Update Password & Enter ERP"}
              </button>
            </form>
          )}

          {/* Quick Demo Role Switcher */}
          <div className="mt-6 pt-5 border-t border-slate-700/80">
            <p className="text-[11px] font-semibold text-slate-400 mb-3 text-center uppercase tracking-wider">
              Select Demo Login Role:
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              <button
                type="button"
                onClick={() => fillQuickCredentials("admin@institution.edu", "password123")}
                className="px-3 py-2 rounded-xl bg-slate-700/70 hover:bg-slate-700 text-xs font-medium text-slate-200 border border-slate-600/60 hover:border-blue-500/50 flex items-center justify-center gap-1.5 transition-all shadow-sm"
              >
                <span>👑</span> Super Admin
              </button>
              <button
                type="button"
                onClick={() => fillQuickCredentials("teacher@institution.edu", "password123")}
                className="px-3 py-2 rounded-xl bg-slate-700/70 hover:bg-slate-700 text-xs font-medium text-slate-200 border border-slate-600/60 hover:border-blue-500/50 flex items-center justify-center gap-1.5 transition-all shadow-sm"
              >
                <span>👨‍🏫</span> Teacher
              </button>
              <button
                type="button"
                onClick={() => fillQuickCredentials("staff@institution.edu", "password123")}
                className="px-3 py-2 rounded-xl bg-slate-700/70 hover:bg-slate-700 text-xs font-medium text-slate-200 border border-slate-600/60 hover:border-blue-500/50 flex items-center justify-center gap-1.5 transition-all shadow-sm"
              >
                <span>💼</span> Dynamic Staff Role
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

