import { reconcileApplePurchases } from "@/lib/iap/apple/reconciliation";

async function reconcile() {
  "use step";
  return reconcileApplePurchases();
}

export async function appleReconciliationWorkflow() {
  "use workflow";
  return reconcile();
}
