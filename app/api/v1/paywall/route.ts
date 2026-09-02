import {
  ApiError,
  apiError,
  authenticateApiRequest,
  noStore,
  requireKeyScope,
} from "@/lib/api/context";
import { resolvePaywall } from "@/lib/paywall/export";
import { getPublishedPaywallForApplication } from "@/lib/paywall/paywalls";
import { productsForApplication } from "@/lib/paywall/products";

/**
 * The paywall an app should show: the published template assigned to this
 * application, with every ProductList filled from its active plans. Drafts are
 * never served, so publishing is the only way a change reaches a device.
 */
export async function GET(request: Request) {
  try {
    const context = await authenticateApiRequest(request);
    requireKeyScope(context, "paywall.read");
    const applicationId = context.application.id;

    const paywall = await getPublishedPaywallForApplication(applicationId);
    if (!paywall) {
      throw new ApiError(
        404,
        "paywall_not_configured",
        "No published paywall is assigned to this application.",
      );
    }

    const products = await productsForApplication(applicationId);
    return Response.json(
      {
        id: paywall.id,
        name: paywall.name,
        designVersion: paywall.designVersion,
        publishedAt: paywall.publishedAt.toISOString(),
        spec: resolvePaywall(paywall.spec, products),
      },
      { headers: noStore },
    );
  } catch (error) {
    return apiError(error);
  }
}
