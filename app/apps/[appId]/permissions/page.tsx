import { PermissionSearch } from "@/components/forms/permission-search";
import { permissionGroup } from "@/lib/permissions/search";
import { Fragment } from "react";
import { DEFAULT_PERMISSION_SCOPES, permissionScopeOptions } from "@/lib/permissions/scope-options";
import {
  createPermissionAction,
  deletePermissionAction,
  updatePermissionAction,
} from "@/app/actions/access";
import { ActionForm, InlineActionButton } from "@/components/forms/action-form";
import { ActionMenu, ActionMenuDivider } from "@/components/ui/action-menu";
import { FormDialog } from "@/components/ui/form-dialog";
import {
  Card,
  CardHeader,
  EmptyState,
  Field,
  Input,
  Table,
  Td,
  Textarea,
  Th,
} from "@/components/ui/primitives";
import { requireApplicationAccess } from "@/lib/console/session";
import { searchPermissions, listPermissionGroups } from "@/lib/subscription/roles";

export default async function PermissionsPage({ params, searchParams }: PageProps<"/apps/[appId]/permissions">) {
  const { appId } = await params;
  await requireApplicationAccess(appId);

  const query = await searchParams;
  const search = typeof query.q === "string" ? query.q.slice(0, 200) : "";
  const selectedGroup = typeof query.group === "string" ? query.group.slice(0, 200) : "";
  const [visible, groupRows] = await Promise.all([
    searchPermissions(appId, search, selectedGroup),
    listPermissionGroups(appId),
  ]);
  const groups = groupRows.map((row) => row.group);
  const groupOf = permissionGroup;

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader
          title="Permissions"
          description="Organize permissions into groups and customize the scopes each role can grant."
        />
        <PermissionSearch key={`${search}:${selectedGroup}`} applicationId={appId} initialQuery={search} initialGroup={selectedGroup} groups={groups} />
        {visible.length === 0 ? (
          <EmptyState
            title={groups.length ? "No matching permissions" : "No permissions defined"}
            description={groups.length ? "Try another search or group filter." : "Add the actions your application wants to gate."}
          />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Key</Th>
                <Th>Title</Th>
                <Th>Scopes</Th>
                <Th>Actions</Th>
              </tr>
            </thead>
            <tbody>
              {visible.map((permission, index) => (
                <Fragment key={permission.id}>
                {index === 0 || groupOf(visible[index - 1]) !== groupOf(permission) ? (
                  <tr><td colSpan={4} className="bg-neutral-50 px-4 py-2 text-sm font-semibold">{groupOf(permission)}</td></tr>
                ) : null}
                <tr>
                  <Td>
                    <code className="rounded bg-neutral-100 px-1.5 py-0.5 text-xs">
                      {permission.key}
                    </code>
                  </Td>
                  <Td>
                    <p className="text-neutral-900">{permission.title}</p>
                    {permission.description ? (
                      <p className="text-xs text-neutral-500">
                        {permission.description}
                      </p>
                    ) : null}
                  </Td>
                  <Td>
                    <span className="text-xs text-neutral-600">
                      {permissionScopeOptions(permission).map((scope) => scope === "selected" ? "all:id" : scope).join(" · ")}
                    </span>
                  </Td>
                  <Td>
                    <ActionMenu label={`Actions for ${permission.title}`}>
                      <FormDialog
                        triggerLabel="Edit"
                        title={`Edit ${permission.title}`}
                        description="Update the display details and supported scopes. The permission key stays fixed."
                        icon="edit"
                        triggerVariant="menu"
                        triggerSize="sm"
                      >
                        <ActionForm
                          action={updatePermissionAction}
                          submitLabel="Save permission"
                        >
                          <input
                            type="hidden"
                            name="applicationId"
                            value={appId}
                          />
                          <input
                            type="hidden"
                            name="permissionId"
                            value={permission.id}
                          />
                          <div className="mt-4 grid gap-3 sm:grid-cols-2">
                            <div className="sm:col-span-2">
                              <Field label="Title">
                                <Input
                                  name="title"
                                  defaultValue={permission.title}
                                  required
                                />
                              </Field>
                            </div>
                            <div className="sm:col-span-2">
                              <Field label="Description">
                                <Textarea
                                  name="description"
                                  rows={2}
                                  defaultValue={permission.description ?? ""}
                                />
                              </Field>
                            </div>
                            <Field label="Group" hint="e.g. market or market.publish; blank uses the key prefix">
                              <Input name="group" defaultValue={permission.group ?? ""} placeholder="market" />
                            </Field>
                            <Field label="Scopes" hint="Comma-separated names; add :id for specific targets">
                              <Input name="scopeOptions" required defaultValue={permissionScopeOptions(permission).map((scope) => scope === "selected" ? "all:id" : scope).join(", ")} />
                            </Field>
                          </div>
                        </ActionForm>
                      </FormDialog>

                      <ActionMenuDivider />

                      <InlineActionButton
                        action={deletePermissionAction}
                        label="Delete"
                        variant="menuDanger"
                        confirmMessage="Delete this permission and remove it from all roles?"
                      >
                        <input type="hidden" name="applicationId" value={appId} />
                        <input
                          type="hidden"
                          name="permissionId"
                          value={permission.id}
                        />
                      </InlineActionButton>
                    </ActionMenu>
                  </Td>
                </tr>
                </Fragment>
              ))}
            </tbody>
          </Table>
        )}
      </Card>

      <div className="flex justify-end">
        <FormDialog
          triggerLabel="New permission"
          title="Create a permission"
          description="Define a permission, its group, and the scopes available to roles."
        >
        <ActionForm action={createPermissionAction} submitLabel="Create permission">
          <input type="hidden" name="applicationId" value={appId} />
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <Field label="Key" hint="e.g. market.publish">
              <Input name="key" required placeholder="market.publish" />
            </Field>
            <Field label="Title">
              <Input name="title" required placeholder="Read articles" />
            </Field>
            <div className="sm:col-span-2">
              <Field label="Description">
                <Textarea name="description" rows={2} />
              </Field>
            </div>
            <Field label="Group" hint="e.g. market or market.publish; blank uses the key prefix">
              <Input name="group" placeholder="market" />
            </Field>
            <Field label="Scopes" hint="Custom scopes work too: approve, approve:id">
              <Input name="scopeOptions" required defaultValue={DEFAULT_PERMISSION_SCOPES.join(", ")} />
            </Field>
          </div>
        </ActionForm>
        </FormDialog>
      </div>
    </div>
  );
}
