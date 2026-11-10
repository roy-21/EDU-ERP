"use client";

import { useEffect, useSyncExternalStore } from "react";
import { identityService } from "./identityServices";

// The signed-in user as the server sees them: role, permissions and subscribed modules.
// The server enforces every rule; this only decides what to show.
const CACHE_MS = 60_000;
const listeners = new Set();
let me = null;
let loadedAt = 0;
let loadedFor = null;
let inFlight = null;

const notify = () => listeners.forEach((listener) => listener());

export const refreshMe = (force = false) => {
  const token = localStorage.getItem("erp_access_token");
  const isFresh = token === loadedFor && Date.now() - loadedAt < CACHE_MS;
  if ((isFresh && !force) || inFlight) return;
  inFlight = identityService
    .me()
    .then((result) => {
      me = result;
    })
    .catch(() => {
      me = { permissions: [], modules: [], role: "" };
    })
    .finally(() => {
      loadedAt = Date.now();
      loadedFor = token;
      inFlight = null;
      notify();
    });
};

const subscribe = (listener) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

export function useMe() {
  const current = useSyncExternalStore(subscribe, () => me, () => null);
  useEffect(() => refreshMe(), []);
  return {
    me: current,
    isReady: current !== null,
    can: (...keys) => Boolean(current) && keys.some((key) => current.permissions?.includes(key)),
    hasModule: (id) => Boolean(current) && current.modules?.includes(id),
    isRole: (...roles) => Boolean(current) && roles.includes(current.role),
  };
}
