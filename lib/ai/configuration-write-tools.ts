import type { WriteToolName } from "./tool-schemas";

/** Writes that change the configuration exercised by application test suites. */
const CONFIGURATION_WRITE_TOOLS = new Set<WriteToolName>([
  "createPlan",
  "updatePlan",
  "setPlanStatus",
  "addPlanEntitlement",
  "removePlanEntitlement",
  "createRole",
  "createPermission",
  "setRolePermissions",
  "createBalanceUnit",
  "setPointRate",
  "createUsageItem",
  "updateUsageItem",
  "createTopup",
  "updateTopup",
  "addTopupEligibilityRule",
  "createCoupon",
  "updateCoupon",
  "setCouponStatus",
  "deleteCoupon",
]);

export function isConfigurationWriteTool(name: WriteToolName): boolean {
  return CONFIGURATION_WRITE_TOOLS.has(name);
}
