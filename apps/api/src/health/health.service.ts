import { ServiceUnavailableException } from "@nestjs/common";

// Resolves when the database answers, else 503. The error never says why: the endpoint is public.
export async function assertDbUp(ping: () => Promise<unknown>) {
  try {
    await ping();
  } catch {
    throw new ServiceUnavailableException();
  }
}
