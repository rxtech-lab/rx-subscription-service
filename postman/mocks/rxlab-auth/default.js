// Local contract stand-in for lib/rxlab/oauth-clients.ts; not a hosted auth service.
// Postman mock handlers run as CommonJS.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const http = require("node:http");
http
  .createServer((req, res) => {
    res.setHeader("Content-Type", "application/json");
    const url = new URL(req.url, "http://localhost");
    if (url.pathname !== "/admin/oauth-clients") {
      res.writeHead(501);
      res.end(JSON.stringify({ error: "unmodeled_endpoint" }));
      return;
    }
    if (req.headers.authorization !== "Bearer test-admin") {
      res.writeHead(403);
      res.end(JSON.stringify({ error: "insufficient_permission" }));
      return;
    }
    const stamp = "2026-01-01T00:00:00Z";
    res.end(
      JSON.stringify({
        clients: [
          {
            id: "project-a",
            name: "Project A",
            description: null,
            iconUrl: null,
            clientType: "confidential",
            isFirstParty: true,
            createdAt: stamp,
            updatedAt: stamp,
          },
        ],
        pagination: { page: 1, pageSize: 100, totalCount: 1, totalPages: 1 },
      }),
    );
  })
  .listen(process.env.PORT);
