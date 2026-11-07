import { WebSocketServer, type WebSocket } from "ws";

// engine.io passes maxHttpBufferSize as `ws`'s maxPayload, but under Bun `ws` is a shim that ignores it. Without this a
// websocket frame of any size reaches the socket handlers. A frame over the limit closes the socket with 1009 and is
// never delivered, as real `ws` does. Polling checks the limit itself.
// ponytail: checks after Bun has buffered the frame, so one frame can still cost up to Bun's own cap (about 16 MB, measured on 1.3.11); pass the limit to Bun.serve's maxPayloadLength if Bun's node:http ever exposes it
export class SizedWebSocketServer extends WebSocketServer {
  override handleUpgrade(...[req, socket, head, cb]: Parameters<WebSocketServer["handleUpgrade"]>) {
    const max = this.options.maxPayload ?? Infinity;
    super.handleUpgrade(req, socket, head, (ws: WebSocket, request) => {
      const emit = ws.emit.bind(ws);
      ws.emit = (event: string | symbol, ...args: unknown[]) => {
        if (event === "message" && Buffer.byteLength(args[0] as string | Buffer) > max) {
          ws.close(1009);
          return false;
        }
        return emit(event, ...args);
      };
      cb(ws, request);
    });
  }
}
