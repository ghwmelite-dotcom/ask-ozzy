// Durable Object for live eClassroom WebSocket rooms
export class ClassroomDO implements DurableObject {
  private sessions: Map<WebSocket, { studentId: string; name: string }> = new Map();
  private state: DurableObjectState;

  constructor(state: DurableObjectState) {
    this.state = state;
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (request.headers.get("Upgrade") === "websocket") {
      const pair = new WebSocketPair();
      const [client, server] = Object.values(pair);

      this.state.acceptWebSocket(server);

      const studentId = url.searchParams.get("studentId") ?? "";
      const name = url.searchParams.get("name") ?? "Student";

      this.sessions.set(server, { studentId, name });

      // Notify others
      this.broadcast({
        type: "student_joined",
        studentId,
        name,
        count: this.sessions.size,
      });

      return new Response(null, { status: 101, webSocket: client });
    }

    // GET /info — room info
    if (url.pathname.endsWith("/info")) {
      return Response.json({
        students: this.sessions.size,
        members: [...this.sessions.values()].map((s) => ({
          studentId: s.studentId,
          name: s.name,
        })),
      });
    }

    return new Response("Expected WebSocket", { status: 400 });
  }

  async webSocketMessage(ws: WebSocket, message: string): Promise<void> {
    try {
      const data = JSON.parse(message);
      const sender = this.sessions.get(ws);

      switch (data.type) {
        case "hand_raise":
          this.broadcast({
            type: "hand_raised",
            studentId: sender?.studentId,
            name: sender?.name,
          });
          break;
        case "hand_lower":
          this.broadcast({
            type: "hand_lowered",
            studentId: sender?.studentId,
          });
          break;
        case "chat_message":
          this.broadcast({
            type: "chat_message",
            studentId: sender?.studentId,
            name: sender?.name,
            text: (data.text || "").slice(0, 500),
            timestamp: Date.now(),
          });
          break;
        case "quiz_answer":
          this.broadcast({
            type: "quiz_response",
            studentId: sender?.studentId,
            name: sender?.name,
            answer: data.answer,
            correct: data.correct,
          });
          break;
        case "whiteboard_sync":
          // Forward tldraw sync messages to all other clients
          this.broadcast(data, ws);
          break;
      }
    } catch {
      // Ignore malformed messages
    }
  }

  async webSocketClose(ws: WebSocket): Promise<void> {
    const session = this.sessions.get(ws);
    this.sessions.delete(ws);
    if (session) {
      this.broadcast({
        type: "student_left",
        studentId: session.studentId,
        name: session.name,
        count: this.sessions.size,
      });
    }
  }

  async webSocketError(ws: WebSocket): Promise<void> {
    this.sessions.delete(ws);
  }

  private broadcast(data: unknown, exclude?: WebSocket): void {
    const msg = JSON.stringify(data);
    for (const [ws] of this.sessions) {
      if (ws !== exclude) {
        try {
          ws.send(msg);
        } catch {
          /* closed */
        }
      }
    }
  }
}
