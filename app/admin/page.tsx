import Portal from "../portal/Portal";

export const metadata = { title: "Administrator Portal | Laundry Loop", robots: "noindex, nofollow" };
export const dynamic = "force-dynamic";

export default function AdminPage() {
  return <Portal portal="admin" serviceSuspended={process.env.LAUNDRY_SERVICE_SUSPENDED === "true"} />;
}
