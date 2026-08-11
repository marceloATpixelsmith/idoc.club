export function getPostgresConnectionUrl(): string {
  const connectionUrl = process.env.POSTGRES_URL;

  if (!connectionUrl) {
    throw new Error('POSTGRES_URL environment variable is not set');
  }

  const parsedUrl = new URL(connectionUrl);
  const isLocalDatabase =
    parsedUrl.hostname === 'localhost' ||
    parsedUrl.hostname === '127.0.0.1' ||
    parsedUrl.hostname === '::1';

  //REQUIRE ENCRYPTION FOR REMOTE DATABASE CONNECTIONS, INCLUDING RENDER.
  if (!isLocalDatabase) {
    parsedUrl.searchParams.set('sslmode', 'require');
  }

  return parsedUrl.toString();
}
