export const MIN_ADMIN_KEY_LENGTH = 32;
// The value the example env files used to ship; never a real key.
const PLACEHOLDER_ADMIN_KEY = "change-me";

// Refuses to boot on a missing, short or placeholder admin key: it grants full admin over every campaign.
export function assertAdminKey(key: string | undefined) {
  if (!key || key.length < MIN_ADMIN_KEY_LENGTH || key === PLACEHOLDER_ADMIN_KEY)
    throw new Error(`ADMIN_KEY must be at least ${MIN_ADMIN_KEY_LENGTH} characters and not "change-me"`);
}

// The guest seat cookie is Secure everywhere but local development and tests (plain http on a LAN address).
export const cookieSecure = (nodeEnv: string | undefined) => nodeEnv !== "development" && nodeEnv !== "test";
