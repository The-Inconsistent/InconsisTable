// Clerk's global metadata and session-claim types, narrowed to what this app sets (docs/development.md, "Clerk").
// Referenced from src/api.ts and src/next.ts, so every consumer of @inconsistable/auth gets them.
import type { ClerkRole } from "./src/role.ts";

declare global {
  // Set by hand per user in the Clerk Dashboard (Users → public metadata); the app never writes it (docs/design.md
  // §3.6). "creator" may start games in the lobby; anyone else only joins by invite. "moderator" works the report
  // queue and enters no campaign. "admin" is a creator who also reaches /admin and can OPEN AS ADMIN at any table.
  interface UserPublicMetadata {
    role?: ClerkRole;
  }

  // The Dashboard's session-token template:
  //   { "metadata": "{{user.public_metadata}}", "name": "{{user.full_name}}", "username": "{{user.username}}" }
  // Values come from the token, so api.ts still checks them at runtime.
  interface CustomJwtSessionClaims {
    metadata?: UserPublicMetadata;
    name?: string | null;
    username?: string | null;
  }
}
