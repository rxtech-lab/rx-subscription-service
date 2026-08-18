import {
  createPermissionAction,
  deletePermissionAction,
  updatePermissionAction,
} from "@/app/actions/access";
import { ActionForm, InlineActionButton } from "@/components/forms/action-form";
import { ActionMenu } from "@/components/ui/action-menu";
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
import { listPermissions } from "@/lib/subscription/roles";

export default async function PermissionsPage({ params }: PageProps<"/apps/[appId]">) {
  const { appId } = await params;
  await requireApplicationAccess(appId);

  const permissions = await listPermissions(appId);

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader
          title="Permissions"
          description="The vocabulary your application checks. Scope is attached per role, not here."
        />
        {permissions.length === 0 ? (
          <EmptyState
            title="No permissions defined"
            description="Add the actions your application wants to gate."
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
              {permissions.map((permission) => (
                <tr key={permission.id}>
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
                      {[
                        permission.supportsAll ? `${permission.key}:all` : null,
                        permission.supportsIds ? `${permission.key}:id1,id2` : null,
                      ]
                        .filter(Boolean)
                        .join("  ·  ")}
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
                            <label className="flex items-center gap-2 text-xs text-neutral-700">
                              <input
                                type="checkbox"
                                name="supportsAll"
                                defaultChecked={permission.supportsAll}
                              />
                              Allow an all scope
                            </label>
                            <label className="flex items-center gap-2 text-xs text-neutral-700">
                              <input
                                type="checkbox"
                                name="supportsIds"
                                defaultChecked={permission.supportsIds}
                              />
                              Allow specific target ids
                            </label>
                          </div>
                        </ActionForm>
                      </FormDialog>
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
              ))}
            </tbody>
          </Table>
        )}
      </Card>

      <div className="flex justify-end">
        <FormDialog
          triggerLabel="New permission"
          title="Create a permission"
          description="Use the bare key. A role decides whether it applies to everything or specific ids."
        >
        <ActionForm action={createPermissionAction} submitLabel="Create permission">
          <input type="hidden" name="applicationId" value={appId} />
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <Field label="Key" hint="e.g. read:a">
              <Input name="key" required placeholder="read:a" />
            </Field>
            <Field label="Title">
              <Input name="title" required placeholder="Read articles" />
            </Field>
            <div className="sm:col-span-2">
              <Field label="Description">
                <Textarea name="description" rows={2} />
              </Field>
            </div>
            <label className="flex items-center gap-2 text-xs text-neutral-700">
              <input type="checkbox" name="supportsAll" defaultChecked />
              Allow an all scope
            </label>
            <label className="flex items-center gap-2 text-xs text-neutral-700">
              <input type="checkbox" name="supportsIds" defaultChecked />
              Allow specific target ids
            </label>
          </div>
        </ActionForm>
        </FormDialog>
      </div>
    </div>
  );
}
