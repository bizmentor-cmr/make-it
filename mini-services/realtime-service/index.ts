// Make It — Real-time mini-service.
// Two servers in one process:
//   - Port 3003: socket.io (external, via Caddy XTransformPort=3003, path "/")
//   - Port 3004: internal HTTP API (Next.js server emits events here)
// Clients connect via io("/?XTransformPort=3003") and join a room named after their workspaceId.

import { createServer } from "http";
import { Server } from "socket.io";

const IO_PORT = 3003;
const INTERNAL_PORT = 3004;

// ── Socket.io server (port 3003) ──
const ioServer = createServer();
const io = new Server(ioServer, {
  path: "/",
  cors: { origin: "*", methods: ["GET", "POST"] },
  pingTimeout: 60000,
  pingInterval: 25000,
});

io.on("connection", (socket) => {
  console.log(`[realtime] connected ${socket.id}`);
  socket.on("join", (payload: { workspaceId?: string }) => {
    if (payload?.workspaceId) {
      socket.join(payload.workspaceId);
      console.log(`[realtime] ${socket.id} joined room ${payload.workspaceId}`);
    }
  });
  socket.on("ping", () => socket.emit("pong", { t: Date.now() }));
  socket.on("disconnect", () => console.log(`[realtime] disconnected ${socket.id}`));
});

ioServer.listen(IO_PORT, () => console.log(`[realtime] socket.io on ${IO_PORT}`));

// ── Internal HTTP API (port 3004) — called by Next.js server ──
const internal = createServer((req, res) => {
  if (req.method === "GET" && req.url === "/health") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: true, io_port: IO_PORT, sockets: io.engine.clientsCount }));
    return;
  }
  if (req.method === "POST" && req.url === "/internal/emit") {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      try {
        const { room, event, data } = JSON.parse(body || "{}");
        if (room) io.to(room).emit(event, data);
        else io.emit(event, data);
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ ok: true }));
      } catch (e) {
        res.writeHead(400, { "content-type": "application/json" });
        res.end(JSON.stringify({ ok: false, error: String(e) }));
      }
    });
    return;
  }
  res.writeHead(404, { "content-type": "application/json" });
  res.end(JSON.stringify({ error: "not found" }));
});

internal.listen(INTERNAL_PORT, "127.0.0.1", () =>
  console.log(`[realtime] internal API on ${INTERNAL_PORT}`)
);

process.on("SIGTERM", () => {
  ioServer.close();
  internal.close();
  setTimeout(() => process.exit(0), 200);
});
process.on("SIGINT", () => {
  ioServer.close();
  internal.close();
  setTimeout(() => process.exit(0), 200);
});
