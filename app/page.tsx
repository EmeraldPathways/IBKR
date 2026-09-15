import DashboardClient from "./dashboard-client";

export const dynamic = "force-dynamic";

export default async function Home() {
  return (
    <DashboardClient
      displayName="Public paper workspace"
      email="paper@public.workspace"
      signOutPath={undefined}
    />
  );
}
