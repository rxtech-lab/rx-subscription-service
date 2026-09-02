"use client";

import { useState } from "react";
import { OAuthClientCombobox } from "@/components/forms/oauth-client-combobox";
import { Field, Select } from "@/components/ui/primitives";
import type { OAuthClientOption } from "@/lib/console/session";

/**
 * The kind picker and the allow-list it governs.
 *
 * Together in one client component because the allow-list only means anything
 * for a publishable key, and a permanently-visible field that a secret key
 * must leave blank reads as something you forgot rather than something that
 * does not apply.
 */
export function ApiKeyKindFields({ clients }: { clients: OAuthClientOption[] }) {
  const [kind, setKind] = useState("secret");

  return (
    <>
      <Field
        label="Kind"
        hint="Secret keys are for backends and can do anything. Publishable keys are safe to ship inside an app: they only work alongside a signed-in user's access token, act only for that user, and cannot move balances or record usage."
      >
        <Select
          name="kind"
          value={kind}
          onChange={(event) => setKind(event.target.value)}
          required
        >
          <option value="secret">Secret — server to server</option>
          <option value="publishable">Publishable — embeddable in a client</option>
        </Select>
      </Field>

      {kind === "publishable" ? (
        <OAuthClientCombobox name="allowedClientIds" clients={clients} />
      ) : null}
    </>
  );
}
