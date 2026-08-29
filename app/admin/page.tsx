import Portal from "../portal/Portal";

export const metadata = { title: "Administrator Portal | Laundry Loop", robots: "noindex, nofollow" };

export default function AdminPage() {
  return <Portal portal="admin" />;
}
