import { redirect } from "next/navigation";

// Stationery is ordinary stock: it lives with the other stock items.
export default function OldStationeryPage() {
  redirect("/admin/inventory/items");
}
