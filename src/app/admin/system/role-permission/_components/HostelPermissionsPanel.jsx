"use client";

const HOSTEL_PERMISSIONS = [
  { id: "view_rooms", label: "View Hostel Rooms" },
  { id: "manage_rooms", label: "Manage Rooms" },
  { id: "manage_allocations", label: "Manage Seat Allocations" },
  { id: "manage_students", label: "Manage Student Information" },
  { id: "configure_rent", label: "Configure Rent" },
  { id: "manage_payments", label: "Manage Payments" },
  { id: "view_due_rent", label: "View Due Rent" },
  { id: "send_reminders", label: "Send Rent Reminders" },
  { id: "export_reports", label: "Export Financial Reports" },
  { id: "manage_meals", label: "Manage Meals and Meal Orders" },
  { id: "manage_visitors", label: "Manage Visitors (register, check in, check out)" },
  { id: "manage_fees", label: "Configure and Assign Fees" },
];

// Stored on the role's "hostel" module entry, and saved with the rest of the role.
export default function HostelPermissionsPanel({ role, disabled, onChange }) {
  if (!role) return null;

  const permissions = Array.isArray(role.permissions) ? role.permissions : [];
  const entry = permissions.find((item) => item.moduleId === "hostel");
  const granted = entry?.hostelPermissions || [];

  const toggle = (id) => {
    const nextGranted = granted.includes(id)
      ? granted.filter((item) => item !== id)
      : [...granted, id];

    const nextEntry = {
      moduleId: "hostel",
      canRead: nextGranted.length > 0,
      canCreate: false,
      canUpdate: false,
      canDelete: false,
      canExport: false,
      canApprove: false,
      ...entry,
      hostelPermissions: nextGranted,
    };

    onChange(
      entry
        ? permissions.map((item) => (item.moduleId === "hostel" ? nextEntry : item))
        : [...permissions, nextEntry]
    );
  };

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5">
      <h3 className="text-sm font-bold text-slate-800">Hostel Management Permissions</h3>
      <p className="mb-3 mt-1 text-xs text-slate-500">
        Controls what &quot;{role.name}&quot; can do in Hostel and Due Rent. Click Save to apply.
      </p>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {HOSTEL_PERMISSIONS.map((item) => (
          <label key={item.id} className="flex items-center gap-2 text-sm text-slate-700">
            <input
              type="checkbox"
              checked={disabled || granted.includes(item.id)}
              disabled={disabled}
              onChange={() => toggle(item.id)}
            />
            {item.label}
          </label>
        ))}
      </div>
    </div>
  );
}
