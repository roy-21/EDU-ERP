"use client";

import { useSyncExternalStore } from "react";

// Custom hostel features used to live in this browser's storage. They now live on the
// server (Feature Builder). This file keeps the built-in cards and reads any old
// browser data once, so it can be imported to the server and then cleared.
const STORAGE_KEY = "erp_hostel_control_board_v1";

export const BUILT_IN_FEATURES = [
  {
    slug: "rooms",
    title: "Room Management",
    description: "Manage hostel buildings, floors, rooms and capacity.",
    href: "/admin/hostel/rooms",
    icon: "🏢",
    count: "Room Records",
    permission: "view_rooms",
  },
  {
    slug: "seats",
    title: "Seat Management",
    description: "Monitor available, occupied and reserved seats.",
    href: "/admin/hostel/seats",
    icon: "🛏️",
    count: "Seat Records",
    permission: "view_rooms",
  },
  {
    slug: "allocation",
    title: "Student Allocation",
    description: "Review applications and assign hostel seats.",
    href: "/admin/hostel/allocation",
    icon: "🎓",
    count: "Applications",
    permission: "manage_allocations",
  },
  {
    slug: "meals",
    title: "Meal Management",
    description: "Manage meal schedules, menus and meal costs.",
    href: "/admin/hostel/meals",
    icon: "🍽️",
    count: "Menus and Orders",
    permission: "manage_meals",
  },
  {
    slug: "visitors",
    title: "Visitor Management",
    description: "Track visitors, student relations and visit times.",
    href: "/admin/hostel/visitors",
    icon: "👥",
    count: "Visit Tickets",
    permission: "manage_visitors",
  },
  {
    slug: "fees",
    title: "Hostel Fee Management",
    description: "Manage hostel fees, payments and outstanding dues.",
    href: "/admin/hostel/fees",
    icon: "💳",
    count: "All Charges",
    permission: "manage_fees",
  },
  {
    slug: "maintenance",
    title: "Maintenance Tickets",
    description: "Track room complaints, repairs and who is handling them.",
    href: "/admin/hostel/maintenance",
    icon: "🛠️",
    count: "Tickets",
    permission: "view_rooms",
  },
  {
    slug: "reports",
    title: "Hostel Reports",
    description: "View occupancy and export data as CSV or PDF.",
    href: "/admin/hostel/reports",
    icon: "📊",
    count: "Reports",
    permission: "view_rooms",
  },
  {
    slug: "audit",
    title: "Audit Log",
    description: "See who changed what in the hostel module.",
    href: "/admin/hostel/audit",
    icon: "📜",
    count: "History",
    permission: "manage_rooms",
  },
  {
    slug: "due-rent",
    title: "Due Rent",
    description: "Students with overdue rent, what they owe and how late it is.",
    href: "/admin/hostel/due-rent",
    icon: "⏰",
    count: "Overdue",
    permission: "view_due_rent",
  },
  {
    slug: "invoices",
    title: "Rent Invoices",
    description: "Monthly invoices, payments, receipts and adjustments.",
    href: "/admin/hostel/invoices",
    icon: "🧾",
    count: "Billing",
    permission: "manage_payments",
  },
  {
    slug: "rent-settings",
    title: "Rent Settings",
    description: "Due days for all, per building or per seat, plus reminders and templates.",
    href: "/admin/hostel/rent-settings",
    icon: "⚙️",
    count: "Configuration",
    permission: "configure_rent",
  },
  {
    slug: "notifications",
    title: "Rent Notifications",
    description: "Every rent reminder and whether it was sent.",
    href: "/admin/hostel/notifications",
    icon: "🔔",
    count: "Delivery Log",
    permission: "send_reminders",
  },
];

export const makeId = (prefix) =>
  `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;

const readLegacy = () => {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(STORAGE_KEY));
    return {
      customFeatures: Array.isArray(parsed?.customFeatures) ? parsed.customFeatures : [],
      records: parsed?.records && typeof parsed.records === "object" ? parsed.records : {},
    };
  } catch {
    return { customFeatures: [], records: {} };
  }
};

let legacyCache = null;
const legacyListeners = new Set();
const subscribeLegacy = (listener) => {
  legacyListeners.add(listener);
  return () => legacyListeners.delete(listener);
};

// Old browser-only features waiting to be imported, or null before the browser is ready.
export const useLegacyFeatures = () =>
  useSyncExternalStore(
    subscribeLegacy,
    () => (legacyCache ||= readLegacy()),
    () => null
  );

export const clearLegacyFeatures = () => {
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Nothing to clear.
  }
  legacyCache = { customFeatures: [], records: {} };
  legacyListeners.forEach((listener) => listener());
};

// Kept for the old demo list component.
export const useHostelBoard = () => ({ disabledBuiltIns: [] });
