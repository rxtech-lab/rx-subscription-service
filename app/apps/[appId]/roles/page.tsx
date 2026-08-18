import {
  createRoleAction,
  deleteRoleAction,
  setRolePermissionsAction,
  updateRoleAction,
} from "@/app/actions/access";
import { ActionForm, InlineActionButton } from "@/components/forms/action-form";
import { ActionMenu, ActionMenuDivider } from "@/components/ui/action-menu";
import { FormDialog } from "@/components/ui/form-dialog";
import {
  Badge,
  Card,
  CardHeader,
  EmptyState,
  Field,
  Input,
  Select,
  Textarea,
} from "@/components/ui/primitives";
import { requireApplicationAccess } from "@/lib/console/session";
import { getRolePermissions, listPermissions, listRoles } from "@/lib/subscription/roles";

export default async function RolesPage({ params }: PageProps<"/apps/[appId]">) {
  const { appId } = await params;
  await requireApplicationAccess(appId);

  const [roles, permissions] = await Promise.all([
    listRoles(appId),
    listPermissions(appId),
  ]);

  const grantsByRole = new Map(
    await Promise.all(
      roles.map(
        async (role) => [role.id, await getRolePermissions(appId, role.id)] as const,
      ),
    ),
  );

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader
          title="Subscription roles"
          description="What a subscriber may do. Granted through plans, and read back by your apps from /api/v1/entitlements."
        />
        {roles.length === 0 ? (
          <EmptyState title="No roles yet" description="Create one below." />
        ) : (
          <div className="divide-y divide-neutral-200">
            {roles.map((role) => {
              const current = grantsByRole.get(role.id);
              const grantByPermission = new Map(
                (current?.grants ?? []).map((grant) => [grant.permissionId, grant]),
              );

              return (
                <div key={role.id} className="px-5 py-4">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-medium text-neutral-900">
                          {role.title}
                        </p>
                        <code className="rounded bg-neutral-100 px-1.5 py-0.5 text-xs text-neutral-600">
                          {role.key}
                        </code>
                        {role.isDefault ? <Badge tone="blue">default</Badge> : null}
                      </div>
                      {role.description ? (
                        <p className="mt-1 text-sm text-neutral-500">
                          {role.description}
                        </p>
                      ) : null}
                      {current && current.expressions.length > 0 ? (
                        <div className="mt-2 flex flex-wrap gap-1">
                          {current.expressions.map((expression) => (
                            <code
                              key={expression}
                              className="rounded bg-neutral-900 px-1.5 py-0.5 text-xs text-neutral-100"
                            >
                              {expression}
                            </code>
                          ))}
                        </div>
                      ) : null}
                    </div>
                    <ActionMenu label={`Actions for ${role.title}`}>
                      <FormDialog
                        triggerLabel="Edit"
                        title={`Edit ${role.title}`}
                        description="Update the role details. Its key stays fixed."
                        icon="edit"
                        triggerVariant="menu"
                        triggerSize="sm"
                      >
                        <ActionForm action={updateRoleAction} submitLabel="Save role">
                          <input
                            type="hidden"
                            name="applicationId"
                            value={appId}
                          />
                          <input type="hidden" name="roleId" value={role.id} />
                          <div className="mt-4 grid gap-3 sm:grid-cols-2">
                            <div className="sm:col-span-2">
                              <Field label="Title">
                                <Input
                                  name="title"
                                  defaultValue={role.title}
                                  required
                                />
                              </Field>
                            </div>
                            <div className="sm:col-span-2">
                              <Field label="Description">
                                <Textarea
                                  name="description"
                                  rows={2}
                                  defaultValue={role.description ?? ""}
                                />
                              </Field>
                            </div>
                            <label className="flex items-center gap-2 text-xs text-neutral-700 sm:col-span-2">
                              <input
                                type="checkbox"
                                name="isDefault"
                                defaultChecked={role.isDefault}
                              />
                              Grant to every user, subscriber or not
                            </label>
                          </div>
                        </ActionForm>
                      </FormDialog>

                      <ActionMenuDivider />

                      <InlineActionButton
                        action={deleteRoleAction}
                        label="Delete"
                        variant="menuDanger"
                        confirmMessage={`Delete the role "${role.title}"?`}
                      >
                        <input type="hidden" name="applicationId" value={appId} />
                        <input type="hidden" name="roleId" value={role.id} />
                      </InlineActionButton>
                    </ActionMenu>
                  </div>

                  {permissions.length > 0 ? (
                    <div className="mt-3">
                      <FormDialog
                        triggerLabel="Edit permissions"
                        title={`Permissions for ${role.title}`}
                        description="Choose the permissions this role grants and optionally scope them to specific ids."
                        icon="edit"
                        size="lg"
                        triggerVariant="secondary"
                        triggerSize="sm"
                      >
                      <ActionForm
                        action={setRolePermissionsAction}
                        submitLabel="Save permissions"
                      >
                        <input type="hidden" name="applicationId" value={appId} />
                        <input type="hidden" name="roleId" value={role.id} />
                        <div className="space-y-2">
                          {permissions.map((permission) => {
                            const grant = grantByPermission.get(permission.id);
                            return (
                              <div
                                key={permission.id}
                                className="grid grid-cols-1 items-center gap-2 rounded-md border border-neutral-200 p-2 sm:grid-cols-[auto_1fr_auto_1fr]"
                              >
                                <input
                                  type="hidden"
                                  name="permissionId"
                                  value={permission.id}
                                />
                                <label className="flex items-center gap-2 text-xs">
                                  <input
                                    type="checkbox"
                                    name={`enabled:${permission.id}`}
                                    defaultChecked={Boolean(grant)}
                                  />
                                  <code>{permission.key}</code>
                                </label>
                                <span className="text-xs text-neutral-500">
                                  {permission.title}
                                </span>
                                <Select
                                  name={`scope:${permission.id}`}
                                  defaultValue={grant?.scope ?? "all"}
                                  className="h-8 w-auto text-xs"
                                >
                                  {permission.supportsAll ? (
                                    <option value="all">all</option>
                                  ) : null}
                                  {permission.supportsIds ? (
                                    <option value="selected">selected ids</option>
                                  ) : null}
                                </Select>
                                <Input
                                  name={`targets:${permission.id}`}
                                  defaultValue={(grant?.targetIds ?? []).join(",")}
                                  placeholder="id1,id2"
                                  className="h-8 text-xs"
                                />
                              </div>
                            );
                          })}
                        </div>
                      </ActionForm>
                      </FormDialog>
                    </div>
                  ) : (
                    <p className="mt-2 text-xs text-neutral-500">
                      Define permissions first to grant them here.
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </Card>

      <div className="flex justify-end">
        <FormDialog
          triggerLabel="New role"
          title="Create a subscription role"
          description="Define a reusable role that plans can grant to subscribers."
        >
        <ActionForm action={createRoleAction} submitLabel="Create role">
          <input type="hidden" name="applicationId" value={appId} />
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <Field label="Key">
              <Input name="key" required placeholder="pro" />
            </Field>
            <Field label="Title">
              <Input name="title" required placeholder="Pro subscriber" />
            </Field>
            <div className="sm:col-span-2">
              <Field label="Description">
                <Textarea name="description" rows={2} />
              </Field>
            </div>
            <label className="flex items-center gap-2 text-xs text-neutral-700">
              <input type="checkbox" name="isDefault" />
              Grant to every user, subscriber or not
            </label>
          </div>
        </ActionForm>
        </FormDialog>
      </div>
    </div>
  );
}
