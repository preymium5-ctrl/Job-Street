import type { Metadata } from "next";
import AdminWorkspace from "@/components/admin/AdminWorkspace";

export const metadata: Metadata = {
  title: "Recruitment workspace",
  robots: { index: false, follow: false },
};
export default function AdminPage() {
  return <AdminWorkspace />;
}
