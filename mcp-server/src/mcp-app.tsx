/**
 * @file Stage-0 MCP-UI spike widget — see docs/design/mcp-ui-docker-ops.md
 * §13 and §11 item 8 (React + Tailwind + shadcn/ui migration, round 5).
 */
import { createRoot } from "react-dom/client";
import { SystemCardApp } from "./system-card/SystemCardApp";
import "./styles/theme.css";

createRoot(document.getElementById("root")!).render(<SystemCardApp />);
