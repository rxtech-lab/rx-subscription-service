import Link from "next/link";
import { createAppUserAction } from "@/app/actions/users";
import { ActionForm } from "@/components/forms/action-form";
import { RxLabUserList } from "@/components/forms/rxlab-user-list";
import { FormDialog } from "@/components/ui/form-dialog";
import {
  Button,
  Card,
  CardHeader,
  EmptyState,
  Table,
  Td,
  Th,
} from "@/components/ui/primitives";
import {
  requireApplicationAccess,
  requireConsoleUser,
} from "@/lib/console/session";
import { isPermissionError } from "@/lib/rxlab/oauth-clients";
import { listAllRxLabUsers } from "@/lib/rxlab/users";
import {
  listAppUserOptions,
  listAppUsers,
} from "@/lib/subscription/users";
import { formatDate } from "@/lib/utils";

async function loadRxLabUsers(accessToken: string) {
  try {
    return {
      users: await listAllRxLabUsers(accessToken),
      error: null,
    };
  } catch (error) {
    if (isPermissionError(error)) {
      return {
        users: [],
        error: "Grant read:user:all in RxLab Auth to add users.",
      };
    }
    console.error("Failed to load the RxLab user directory", error);
    return {
      users: [],
      error: "The RxLab user directory is unavailable.",
    };
  }
}

export default async function UsersPage({
  params,
  searchParams,
}: PageProps<"/apps/[appId]">) {
  const { appId } = await params;
  const { page } = await searchParams;
  await requireApplicationAccess(appId);
  const consoleUser = await requireConsoleUser();

  const requestedPage = Number(Array.isArray(page) ? page[0] : page) || 1;
  const [{ users, pagination }, appUserOptions, directory] = await Promise.all([
    listAppUsers(appId, requestedPage),
    listAppUserOptions(appId),
    loadRxLabUsers(consoleUser.accessToken),
  ]);
  const existingRxLabUserIds = new Set(
    appUserOptions.map((user) => user.rxlabUserId),
  );
  const availableUsers = directory.users.filter(
    (user) => !existingRxLabUserIds.has(user.sub),
  );
  const addUserUnavailableReason =
    directory.error ??
    (availableUsers.length === 0
      ? "All available RxLab users have already been added."
      : null);

  return (
    <Card>
      <CardHeader
        title="Users"
        description="One record per rxlab identity per application, each with its own balances, level, and usage."
        action={
          availableUsers.length > 0 ? (
            <div className="shrink-0 whitespace-nowrap">
              <FormDialog
                triggerLabel="Add user"
                title="Add an RxLab user"
                description="Search the RxLab user directory and add the selected identity to this application."
                size="lg"
                triggerSize="sm"
              >
                <ActionForm
                  action={createAppUserAction}
                  submitLabel="Add user"
                  pendingLabel="Adding user…"
                  autoComplete="off"
                >
                  <input type="hidden" name="applicationId" value={appId} />
                  <RxLabUserList
                    users={availableUsers.map((user) => ({
                      id: user.id,
                      name: user.name,
                      email: user.email,
                    }))}
                  />
                </ActionForm>
              </FormDialog>
            </div>
          ) : (
            <div className="max-w-64 shrink-0 text-right">
              <Button
                type="button"
                size="sm"
                className="whitespace-nowrap"
                disabled
              >
                Add user
              </Button>
              <p className="mt-1 text-xs leading-4 text-slate-500">
                {addUserUnavailableReason}
              </p>
            </div>
          )
        }
      />
      {users.length === 0 ? (
        <EmptyState
          title="No users yet"
          description="Add a user from the RxLab directory, or let your app create one when it first references the identity through the API."
        />
      ) : (
        <>
          <Table>
            <thead>
              <tr>
                <Th>User</Th>
                <Th>Level</Th>
                <Th>Created</Th>
                <Th></Th>
              </tr>
            </thead>
            <tbody>
              {users.map((user) => (
                <tr key={user.id}>
                  <Td>
                    <p className="font-medium text-neutral-900">
                      {user.displayName || user.email || "Unnamed"}
                    </p>
                    <p className="font-mono text-xs text-neutral-500">
                      {user.rxlabUserId}
                    </p>
                  </Td>
                  <Td>
                    {user.level}
                    {user.levelKey ? (
                      <span className="ml-1 text-xs text-neutral-500">
                        ({user.levelKey})
                      </span>
                    ) : null}
                  </Td>
                  <Td>
                    <span className="text-xs text-neutral-500">
                      {formatDate(user.createdAt)}
                    </span>
                  </Td>
                  <Td>
                    <Link
                      href={`/apps/${appId}/users/${user.id}`}
                      className="text-xs text-neutral-600 underline hover:text-neutral-900"
                    >
                      Manage
                    </Link>
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>

          {pagination.totalPages > 1 ? (
            <div className="flex items-center justify-between px-5 py-3 text-xs text-neutral-500">
              <span>
                Page {pagination.page} of {pagination.totalPages}
              </span>
              <div className="flex gap-3">
                {pagination.page > 1 ? (
                  <Link
                    href={`/apps/${appId}/users?page=${pagination.page - 1}`}
                    className="underline hover:text-neutral-900"
                  >
                    Previous
                  </Link>
                ) : null}
                {pagination.page < pagination.totalPages ? (
                  <Link
                    href={`/apps/${appId}/users?page=${pagination.page + 1}`}
                    className="underline hover:text-neutral-900"
                  >
                    Next
                  </Link>
                ) : null}
              </div>
            </div>
          ) : null}
        </>
      )}
    </Card>
  );
}
