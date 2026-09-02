import Link from "next/link";
import { ArrowUpRight, Smartphone } from "lucide-react";
import { setApplicationPaywallAction } from "@/app/actions/paywalls";
import { ActionForm } from "@/components/forms/action-form";
import { PhoneCanvas } from "@/components/paywall/canvas";
import {
  Badge,
  Card,
  CardHeader,
  EmptyState,
  Field,
  Select,
} from "@/components/ui/primitives";
import { requireApplicationAccess } from "@/lib/console/session";
import { getApplicationPaywall, listPaywalls } from "@/lib/paywall/paywalls";
import { productsForApplication } from "@/lib/paywall/products";
import { formatDate } from "@/lib/utils";

export default async function ApplicationPaywallPage({
  params,
}: PageProps<"/apps/[appId]/paywall">) {
  const { appId } = await params;
  await requireApplicationAccess(appId);

  const [paywalls, assigned, products] = await Promise.all([
    listPaywalls(),
    getApplicationPaywall(appId),
    productsForApplication(appId),
  ]);
  const published = assigned?.publishedSpec ?? null;

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader
          title="Paywall"
          description="Pick the template this application shows. Templates live in the shared Paywalls library; only the published version reaches the app."
          action={
            <Link
              href="/paywalls"
              prefetch={false}
              className="flex items-center gap-1 text-xs font-semibold text-blue-700 hover:underline"
            >
              Manage paywalls
              <ArrowUpRight className="size-3.5" aria-hidden="true" />
            </Link>
          }
        />
        <div className="px-5 py-4">
          {paywalls.length === 0 ? (
            <EmptyState
              title="No paywall templates yet"
              description="Create one in the Paywalls section, then come back to assign it."
            />
          ) : (
            <ActionForm action={setApplicationPaywallAction} submitLabel="Save" pendingLabel="Saving…">
              <input type="hidden" name="applicationId" value={appId} />
              <Field label="Template">
                <Select name="paywallId" defaultValue={assigned?.id ?? ""}>
                  <option value="">None — the app shows no paywall</option>
                  {paywalls.map((paywall) => (
                    <option key={paywall.id} value={paywall.id}>
                      {paywall.name} · {paywall.publishedSpec ? "Published" : "Draft only"}
                    </option>
                  ))}
                </Select>
              </Field>
            </ActionForm>
          )}
        </div>
      </Card>

      {assigned ? (
        <Card>
          <CardHeader
            title={assigned.name}
            description={
              published
                ? `Published ${formatDate(assigned.publishedAt)}. Shown with this application's active plans.`
                : "This template has never been published, so the app receives no paywall yet."
            }
            action={
              <div className="flex items-center gap-2">
                {published ? <Badge tone="green">Published</Badge> : <Badge tone="amber">Draft only</Badge>}
                <Link
                  href={`/paywalls/${assigned.id}`}
                  prefetch={false}
                  className="flex items-center gap-1 text-xs font-semibold text-blue-700 hover:underline"
                >
                  Open in editor
                  <ArrowUpRight className="size-3.5" aria-hidden="true" />
                </Link>
              </div>
            }
          />
          {products.length === 0 ? (
            <p className="border-b border-amber-100 bg-amber-50 px-5 py-2 text-xs text-amber-900">
              This application has no active plans, so product lists render empty. Publish a plan
              on the Plans page.
            </p>
          ) : null}
          {published ? (
            <div className="h-[760px] bg-[radial-gradient(circle,rgba(148,163,184,0.35)_1px,transparent_1px)] [background-size:18px_18px]">
              <PhoneCanvas
                spec={published}
                products={products}
                scheme="light"
                mode="preview"
                showDevicePicker
              />
            </div>
          ) : (
            <EmptyState
              title="Nothing published"
              description="Open the template in the editor and press Publish."
            />
          )}
        </Card>
      ) : null}

      <Card>
        <CardHeader
          title="Fetching the paywall"
          description="The app requests the published paywall with a publishable key. Product lists come back filled from this application's plans."
        />
        <pre className="overflow-x-auto px-5 py-4 text-xs text-neutral-700">
          {`# From your app, with the signed-in user's rxlab access token
curl "$BASE/api/v1/paywall" \\
  -H "X-Api-Key: $PUBLISHABLE_KEY" \\
  -H "Authorization: Bearer $USER_ACCESS_TOKEN"

# From your backend
curl "$BASE/api/v1/paywall" -H "X-Api-Key: $SECRET_KEY"

# => { "id", "name", "designVersion", "publishedAt", "spec": { "version": 1, "theme", "root", "deviceLayouts"?, "materialYou"? } }
# => 404 paywall_not_configured until a published template is assigned`}
        </pre>
        <div className="flex items-start gap-3 border-t border-slate-100 px-5 py-4 text-xs leading-5 text-slate-500">
          <Smartphone className="mt-0.5 size-4 shrink-0 text-slate-400" aria-hidden="true" />
          <p>
            Render <code className="rounded bg-slate-100 px-1">spec.root</code> recursively: layout
            nodes map to VStack/HStack/ZStack/Grid/List/ScrollView (or Column/Row/Box/LazyVerticalGrid/
            LazyColumn in Compose), leaves to Text, Image, Button, Badge, FeatureRow, Link, Spacer,
            Divider, and ProductList. The Export dialog in the editor documents the modifiers and
            actions.
            The root is the iPhone fallback; use the matching <code>deviceLayouts</code> root when
            present. Android and foldable apps derive Material You roles from{" "}
            <code>materialYou.seedColor</code>.
          </p>
        </div>
      </Card>
    </div>
  );
}
