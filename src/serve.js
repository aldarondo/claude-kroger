/**
 * claude-kroger MCP Server — HTTP/SSE entry point.
 * Listens on PORT (default 8771) for SSE connections.
 */

import './logger.js';
import express from 'express';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { createServer } from './server.js';

const PORT = parseInt(process.env.PORT || '8771', 10);
const app = express();
const transports = new Map();

app.get('/sse', async (req, res) => {
  const transport = new SSEServerTransport('/messages', res);
  transports.set(transport.sessionId, transport);
  res.on('close', () => transports.delete(transport.sessionId));
  const server = createServer();
  await server.connect(transport);
});

app.post('/messages', express.json(), async (req, res) => {
  const transport = transports.get(req.query.sessionId);
  if (!transport) return res.status(404).json({ error: 'Session not found' });
  await transport.handlePostMessage(req, res);
});

app.listen(PORT, () => console.error(`[MCP SSE] claude-kroger listening on port ${PORT}`));
