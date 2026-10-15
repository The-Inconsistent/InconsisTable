import type { UserWebhook } from "@inconsistable/auth/api";

// The part of the table socket this service drives (TableGateway has it), so the service imports no Nest code.
type Table = { kickUser(userId: string): Promise<void> };

// A Clerk user change reaches the open sockets: a deleted user, a locked one, or one whose platform role no longer
// matches the copy the app last saw all drop and resolve their seat again. A profile edit that changes none of those
// leaves the table alone. A user the app has never seen has no socket. True when the user was kicked.
export async function applyUserWebhook(
  change: UserWebhook,
  { table, storedRole }: { table: Table; storedRole: (userId: string) => Promise<string | null | undefined> },
): Promise<boolean> {
  const kick = change.type === "user.deleted" || change.locked || (await storedRole(change.userId)) !== change.role;
  if (kick) await table.kickUser(change.userId);
  return kick;
}
