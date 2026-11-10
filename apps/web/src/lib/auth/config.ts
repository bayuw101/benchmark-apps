import "server-only";

/**
 * The mock sign-in is an auth bypass by design, so it must never be live by accident:
 * on in development, and in a production build only when AUTH_MODE=mock is set explicitly
 * (e.g. a staging demo before Entra ID exists).
 */
export const mockAuthEnabled = process.env.NODE_ENV !== "production" || process.env.AUTH_MODE === "mock";
