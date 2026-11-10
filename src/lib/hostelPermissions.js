"use client";

import { useEffect, useSyncExternalStore } from "react";
import { hostelService } from "./erpServices";

const CACHE_MS = 60_000;

const listeners = new Set();
let permissions = null;
let loadedAt = 0;
let loadedFor = null;
let inFlight = null;

const notify = () => listeners.forEach((listener) => listener());

const refresh = () => {
  const token = localStorage.getItem("erp_access_token");
  const isFresh = token === loadedFor && Date.now() - loadedAt < CACHE_MS;
  if (isFresh || inFlight) return;

  inFlight = hostelService
    .getMyPermissions()
    .then((result) => {
      permissions = result.permissions;
    })
    .catch(() => {
      // The server decides access, so an unknown state simply hides the controls.
      permissions = [];
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

export function useHostelPermissions() {
  const current = useSyncExternalStore(
    subscribe,
    () => permissions,
    () => null
  );

  useEffect(refresh, []);

  return {
    isReady: current !== null,
    has: (...anyOf) => Boolean(current) && anyOf.some((item) => current.includes(item)),
  };
}
