/**
 * @file Docker fleet dashboard — design doc §5 item 1 / §11 Stages 1-4,
 * item 8 (React + Tailwind + shadcn/ui migration, round 5). Mutating
 * actions (Stage 4, §11 item 4) live behind the Actions tab with
 * tier-gated confirm dialogs — see ConfirmDialog.tsx and §9's
 * defense-in-depth requirement.
 */
import { createRoot } from "react-dom/client";
import { DashboardApp } from "./dashboard/DashboardApp";
import "./styles/theme.css";

createRoot(document.getElementById("root")!).render(<DashboardApp />);
