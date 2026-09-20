/**
 * @file Investigation report — design doc §11 item 3 / §5 item 3, item 8
 * (React + Tailwind + shadcn/ui migration, round 5). This is a terminal,
 * point-in-time report: no refresh, no polling — the agent calls
 * build-investigation-report once with its findings, and this just
 * renders them.
 *
 * Remediation items can carry a structured `action` (§11 item 4), rendered
 * as a "Run" button — but it goes through the exact same confirm-dialog
 * gate as the dashboard's own Tier 1/2 actions (useConfirm, imported from
 * the dashboard widget's own source — see ConfirmDialog.tsx's comment for
 * why source-level reuse across independently-bundled resources is fine
 * even though runtime/network sharing between them isn't). An
 * agent-authored report can *suggest* a tool+id pair from a fixed
 * server-side enum — it can never skip the human clicking through this
 * dialog. See SKILL.md's "known, deliberate gap" note for the residual
 * risk this still doesn't close (the dialog is this iframe's own JS, not
 * server-verified).
 */
import { createRoot } from "react-dom/client";
import { ReportApp } from "./report/ReportApp";
import "./styles/theme.css";

createRoot(document.getElementById("root")!).render(<ReportApp />);
