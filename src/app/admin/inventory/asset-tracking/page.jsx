import { redirect } from "next/navigation";

// Computers, lab equipment, furniture and asset tracking are one asset register now.
export default function OldAssetPage() {
  redirect("/admin/inventory/assets");
}
