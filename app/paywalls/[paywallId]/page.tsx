import { notFound } from "next/navigation";
import { PaywallEditor } from "@/components/paywall/paywall-editor";
import { getManagedApplications, requireConsoleUser } from "@/lib/console/session";
import { getPaywall, listPaywallVersions } from "@/lib/paywall/paywalls";

export default async function PaywallEditorPage({
  params,
}: PageProps<"/paywalls/[paywallId]">) {
  await requireConsoleUser();

  const { paywallId } = await params;
  const [paywall, applications, versions] = await Promise.all([
    getPaywall(paywallId),
    getManagedApplications(),
    listPaywallVersions(paywallId),
  ]);
  if (!paywall) notFound();

  const currentVersion = versions[0]?.version ?? 1;
  const publishedVersion = versions.find((version) => version.publishedAt)?.version ?? null;

  return (
    <PaywallEditor
      paywall={{
        id: paywall.id,
        name: paywall.name,
        description: paywall.description,
        draftSpec: paywall.draftSpec,
        publishedSpec: paywall.publishedSpec,
        currentVersion,
        publishedVersion,
        publishedAt: paywall.publishedAt?.toISOString() ?? null,
        updatedAt: paywall.updatedAt.toISOString(),
      }}
      versions={versions.map((version) => ({
        ...version,
        createdAt: version.createdAt.toISOString(),
        publishedAt: version.publishedAt?.toISOString() ?? null,
      }))}
      applications={applications.map((application) => ({
        id: application.id,
        name: application.name,
      }))}
    />
  );
}
