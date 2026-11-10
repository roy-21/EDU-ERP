import { redirect } from "next/navigation";

// Custom features now live on the server and open from one shared page.
export default async function HostelCustomFeatureRoute({ params }) {
  const { slug } = await params;
  redirect(`/admin/features/hostel/${encodeURIComponent(slug)}`);
}
