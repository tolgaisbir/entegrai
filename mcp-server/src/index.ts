import "dotenv/config";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { ListToolsRequestSchema, CallToolRequestSchema } from "@modelcontextprotocol/sdk/types.js";

// DESIGN.md Bölüm 3 — MCP Server: mcp_integrations tablosundaki kayıtlara göre
// dinamik tool tanımları oluşturur, çağıran kullanıcının role'üne göre
// erişim/filtre uygular (role_mcp_permissions). — TODO: dinamik tool yükleme

// DESIGN.md Bölüm 10.6 — Şablon yönetim tool'ları — TODO
//   template.create_from_session / template.save / template.update_step / template.delete_step

const server = new Server(
  { name: "tegrai-mcp-server", version: "0.1.0" },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => {
  return { tools: [] };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  throw new Error(`Unknown tool: ${request.params.name}`);
});

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("tegrai-mcp-server running on stdio");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
