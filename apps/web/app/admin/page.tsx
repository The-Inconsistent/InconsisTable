import { AdminView } from "@/components/admin/admin-view/admin-view";

// The admin's list of campaigns. The page holds nothing: the key is typed in the browser and every call carries it, so
// the api is the only guard.
export default function AdminPage() {
  return <AdminView />;
}
