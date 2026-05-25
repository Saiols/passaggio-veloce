// Vitest mock for the `server-only` package.
// In the real Next.js runtime this package throws if imported on the client.
// In unit tests there is no client/server boundary, so we export an empty module.
export {};
