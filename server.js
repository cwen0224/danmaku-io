const http = require("http");
const { WebSocketServer } = require("ws");

const PORT = Number(process.env.PORT || 8080);

const server = http.createServer((req, res) => {
  if (req.url === "/health") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: true, clients: peers.size }));
    return;
  }
  res.writeHead(200, { "content-type": "text/plain; charset=utf-8" });
  res.end("Danmaku IO relay server is running.\\n");
});

const wss = new WebSocketServer({ server });
const peers = new Map();

function randomId() {
  return Math.random().toString(36).slice(2, 10);
}

function safeSend(ws, payload) {
  if (ws.readyState === ws.OPEN) {
    ws.send(JSON.stringify(payload));
  }
}

function broadcast(payload, exceptId) {
  for (const [id, peer] of peers) {
    if (id === exceptId) {
      continue;
    }
    safeSend(peer.ws, payload);
  }
}

wss.on("connection", (ws) => {
  const id = randomId();
  peers.set(id, {
    ws,
    state: {
      id,
      x: 0,
      y: 0,
      facing: 0,
      hp: 100,
      weapon: "未知",
      t: Date.now()
    }
  });

  const peerList = Array.from(peers.values())
    .map((p) => p.state)
    .filter((s) => s.id !== id);

  safeSend(ws, { type: "welcome", id, peers: peerList });
  broadcast({ type: "peer_join", peer: peers.get(id).state }, id);

  ws.on("message", (raw) => {
    let message;
    try {
      message = JSON.parse(raw.toString());
    } catch {
      return;
    }

    const peer = peers.get(id);
    if (!peer) {
      return;
    }

    if (message.type === "state" && message.state) {
      peer.state = {
        ...peer.state,
        x: Number(message.state.x) || 0,
        y: Number(message.state.y) || 0,
        facing: Number(message.state.facing) || 0,
        hp: Number(message.state.hp) || 0,
        weapon: String(message.state.weapon || "未知"),
        t: Date.now()
      };
      broadcast({ type: "peer_state", peer: peer.state }, id);
    }
  });

  ws.on("close", () => {
    peers.delete(id);
    broadcast({ type: "peer_leave", id });
  });

  ws.on("error", () => {
    ws.close();
  });
});

server.listen(PORT, () => {
  console.log(`Relay server listening on ws://localhost:${PORT}`);
});
