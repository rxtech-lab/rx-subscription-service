"use server";

import { signOut } from "@/lib/auth";

/** Clears the console session and drops the admin back on the sign-in page. */
export async function signOutAction() {
  await signOut({ redirectTo: "/login" });
}
