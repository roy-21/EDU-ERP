// src/components/AdminLayoutClient.jsx
"use client";

import { useState, useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import Sidebar from "./Sidebar";
import Navbar from "./Navbar";
import Link from "next/link";
import { authService } from "@/lib/auth";
import { useMe } from "@/lib/useMe";
import { pathAccess } from "@/lib/access";

// Shown instead of a page the user has no permission for. The server refuses its requests too.
function LockedPage({ reason, notSubscribed, isAdmin }) {
  return (
    <div className="mx-auto mt-16 max-w-md rounded-xl border border-slate-200 bg-white p-8 text-center shadow-sm">
      <p className="text-4xl" aria-hidden="true">🔒</p>
      <h1 className="mt-3 text-lg font-bold text-slate-800">Locked</h1>
      <p className="mt-2 text-sm text-slate-600">{reason}</p>
      {notSubscribed && isAdmin ? (
        <Link href="/admin/settings/subscription" className="mt-4 inline-block rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700">Add this module</Link>
      ) : (
        <p className="mt-1 text-xs text-slate-500">{notSubscribed ? "Your institution's administrator can add it from Subscription & Modules." : "Ask your institution's administrator if you need access."}</p>
      )}
    </div>
  );
}

// Rendered only inside the signed-in admin shell, so public pages never ask who is signed in.
function GuardedPage({ pathname, children }) {
  const { me, isReady } = useMe();
  if (!isReady) {
    return <div className="mt-16 flex justify-center"><div className="h-8 w-8 animate-spin rounded-full border-4 border-blue-500 border-t-transparent" /></div>;
  }
  const access = pathAccess(me, pathname);
  return access.ok ? children : <LockedPage reason={access.reason} notSubscribed={access.notSubscribed} isAdmin={me?.role === "ADMIN" || me?.role === "SUPER_ADMIN"} />;
}

export default function AdminLayoutClient({ children, searchQuery }) {
  const pathname = usePathname();
  const router = useRouter();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [checkingAuth, setCheckingAuth] = useState(true);

  const isAdminRoute = pathname.startsWith("/admin");

  // Public pages render without the shell and never use this state.
  useEffect(() => {
    if (!isAdminRoute) return undefined;
    let isCurrent = true;
    Promise.resolve().then(() => {
      if (!isCurrent) return;
      if (!authService.isAuthenticated()) {
        setIsAuthenticated(false);
        setCheckingAuth(false);
        router.replace(`/login?from=${encodeURIComponent(pathname)}`);
      } else if (authService.getCurrentUser()?.role === "STUDENT") {
        // Students have their own portal; the server would refuse them here anyway.
        router.replace("/portal");
      } else {
        setIsAuthenticated(true);
        setCheckingAuth(false);
      }
    });
    return () => { isCurrent = false; };
  }, [pathname, isAdminRoute, router]);

  // For non-admin pages (such as /login or public landing page), render clean page without admin sidebar/navbar
  if (!isAdminRoute) {
    return <>{children}</>;
  }

  // If checking authentication status or unauthenticated on an admin route
  if (checkingAuth || !isAuthenticated) {
    return (
      <div className="min-h-screen bg-slate-900 flex flex-col items-center justify-center p-4">
        <div className="w-10 h-10 border-4 border-blue-500 border-t-transparent rounded-full animate-spin mb-4"></div>
        <p className="text-white text-sm font-semibold tracking-wide">
          Verifying Institutional Session...
        </p>
        <p className="text-slate-400 text-xs mt-1">
          Access Restricted. Redirecting to Central Login...
        </p>
      </div>
    );
  }

  // Authenticated Admin Shell
  return (
    <div className="flex h-screen bg-gray-100 overflow-hidden">
      <Sidebar 
        isOpen={sidebarOpen} 
        onClose={() => setSidebarOpen(false)} 
        searchQuery={searchQuery}
      />
      <div className="flex-1 flex flex-col overflow-hidden">
        <Navbar onMenuClick={() => setSidebarOpen((pre) => !pre)} />
        <main className="flex-1 overflow-y-auto p-4 lg:p-6 bg-gray-50">
          <GuardedPage pathname={pathname}>{children}</GuardedPage>
        </main>
      </div>
    </div>
  );
}
