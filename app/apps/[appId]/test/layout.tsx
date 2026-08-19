import { TestTabs } from "@/components/testing/test-tabs";

/**
 * Both halves of the Test tab sit under this layout, so the switch between
 * clicking through as a test user and running a suite is one control that never
 * moves.
 */
export default async function TestLayout({
  children,
  params,
}: LayoutProps<"/apps/[appId]/test">) {
  const { appId } = await params;

  return (
    <div className="space-y-4">
      <TestTabs appId={appId} />
      {children}
    </div>
  );
}
