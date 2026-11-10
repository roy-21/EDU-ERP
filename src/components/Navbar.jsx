// src/components/Navbar.jsx
"use client";
import React, { useState, useEffect } from "react";
import { authService } from "@/lib/auth";

export default function Navbar({ onMenuClick }) {
  const [user, setUser] = useState(null);
  const [dropdownOpen, setDropdownOpen] = useState(false);

  useEffect(() => {
    const currentUser = authService.getCurrentUser();
    if (currentUser) {
      setUser(currentUser);
    }
  }, []);

  const handleLogout = () => {
    authService.logout();
  };

  const getInitials = (name) => {
    if (!name) return "EA";
    const parts = name.split(" ");
    return parts.length > 1 ? `${parts[0][0]}${parts[parts.length - 1][0]}` : name.slice(0, 2).toUpperCase();
  };

  return (
    <header className="sticky top-0 z-30 h-16 bg-white border-b border-slate-200 shadow-sm flex items-center justify-between px-4 lg:px-6">
      
      {/* Left Side: Hamburger Menu & Welcome Text */}
      <div className="flex items-center gap-4">
        {/* Hamburger Button */}
        <button
          onClick={onMenuClick}
          className="text-slate-600 hover:text-slate-900 focus:outline-none"
          aria-label="Open Menu"
        >
          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 6h16M4 12h16M4 18h16" />
          </svg>
        </button>
        
        {/* Welcome Text */}
        <div className="hidden sm:block">
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-semibold text-slate-700">
              Welcome back, {user?.fullName || "Institutional Admin"}
            </h2>
            <span className="text-[10px] px-2 py-0.5 rounded-full font-bold bg-blue-100 text-blue-800 border border-blue-200">
              {user?.role || "ADMIN"}
            </span>
          </div>
          <p className="text-xs text-slate-400">NextGen Multi-Tenant ERP Central Communication Hub</p>
        </div>
      </div>

      {/* Right Side: Links, Notifications & Profile */}
      <div className="flex items-center gap-2 md:gap-4 relative">
        
        {/* Quick Nav Links */}
        <nav className="hidden md:flex items-center gap-1 bg-slate-50 p-1 rounded-lg">
          <a href="/admin" className="px-3 py-1.5 text-xs font-medium text-slate-600 rounded-md hover:bg-white hover:text-slate-900 hover:shadow-sm transition-all">
            Dashboard
          </a>
          <a href="/admin/system/role-permission" className="px-3 py-1.5 text-xs font-medium text-slate-600 rounded-md hover:bg-white hover:text-slate-900 hover:shadow-sm transition-all">
            32-Module RBAC
          </a>
          <a href="/login" className="px-3 py-1.5 text-xs font-medium text-blue-600 rounded-md hover:bg-white hover:shadow-sm transition-all">
            Role Switcher
          </a>
        </nav>

        {/* Notification Bell */}
        <button className="relative p-2 text-slate-500 hover:bg-slate-100 rounded-full transition-colors">
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
          </svg>
          <span className="absolute top-1.5 right-1.5 w-2 h-2 bg-emerald-500 rounded-full animate-ping"></span>
          <span className="absolute top-1.5 right-1.5 w-2 h-2 bg-emerald-500 rounded-full"></span>
        </button>

        {/* Divider */}
        <div className="hidden md:block h-8 w-px bg-slate-200"></div>

        {/* Admin Profile Area */}
        <div className="relative">
          <button
            type="button"
            onClick={() => setDropdownOpen(!dropdownOpen)}
            className="flex items-center gap-3 p-1.5 rounded-lg hover:bg-slate-50 transition-colors focus:outline-none"
          >
            {/* Avatar */}
            <div className="h-8 w-8 rounded-full bg-gradient-to-br from-blue-600 to-indigo-700 flex items-center justify-center text-white text-xs font-bold shadow-sm">
              {getInitials(user?.fullName)}
            </div>
            
            {/* Name & Email */}
            <div className="hidden sm:block text-left">
              <p className="text-xs font-bold text-slate-700 leading-tight">
                {user?.fullName || "Super Admin"}
              </p>
              <p className="text-[10px] text-slate-400 font-mono leading-tight">
                {user?.username || user?.email || "admin@institution.edu"}
              </p>
            </div>
            
            {/* Dropdown Arrow */}
            <svg className={`hidden sm:block w-3.5 h-3.5 text-slate-400 transition-transform ${dropdownOpen ? "rotate-180" : ""}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7" />
            </svg>
          </button>

          {/* User Profile Dropdown Menu */}
          {dropdownOpen && (
            <div className="absolute right-0 mt-2 w-64 bg-white rounded-xl shadow-xl border border-slate-200 py-2 z-50 animate-in fade-in zoom-in-95 duration-100">
              <div className="px-4 py-2 border-b border-slate-100">
                <p className="text-xs font-bold text-slate-800">{user?.fullName || "Master Administrator"}</p>
                <p className="text-[11px] text-slate-500 font-mono">{user?.email || "admin@institution.edu"}</p>
                <div className="mt-1 flex items-center gap-1.5">
                  <span className="text-[10px] px-2 py-0.5 rounded font-semibold bg-emerald-100 text-emerald-800">
                    Role: {user?.role || "ADMIN"}
                  </span>
                  <span className="text-[10px] text-slate-400">RLS: inst-001</span>
                </div>
              </div>

              <div className="py-1 text-xs">
                <a
                  href="/admin/settings/general"
                  className="flex items-center gap-2 px-4 py-2 text-slate-700 hover:bg-slate-50 transition-colors"
                >
                  <span>⚙️</span> System Settings
                </a>
                <a
                  href="/admin/system/role-permission"
                  className="flex items-center gap-2 px-4 py-2 text-slate-700 hover:bg-slate-50 transition-colors"
                >
                  <span>🛡️</span> RBAC Permissions Matrix
                </a>
                <a
                  href="/login"
                  className="flex items-center gap-2 px-4 py-2 text-blue-600 hover:bg-blue-50 transition-colors"
                >
                  <span>🔄</span> Switch Account / Role
                </a>
              </div>

              <div className="pt-1 border-t border-slate-100">
                <button
                  type="button"
                  onClick={handleLogout}
                  className="w-full text-left flex items-center gap-2 px-4 py-2 text-xs font-semibold text-rose-600 hover:bg-rose-50 transition-colors"
                >
                  <span>🚪</span> Sign Out
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
