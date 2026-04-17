import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import * as queries from "../db/queries.js";

export function toolTextResult(data: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
    structuredContent: { result: data } as Record<string, unknown>
  };
}

/** Registers all clinical read tools (shared by HTTP MCP and stdio). */
export function registerClinicalTools(server: McpServer): void {
  server.registerTool(
    "patient_info",
    {
      title: "Patient Info",
      description: "Get basic patient info plus admissions (by subject_id).",
      inputSchema: z.object({
        subject_id: z.number().int().positive()
      })
    },
    async ({ subject_id }) => toolTextResult(await queries.getPatientInfo(subject_id))
  );

  server.registerTool(
    "latest_lab",
    {
      title: "Latest Lab",
      description: "Get latest lab value for a subject and itemid.",
      inputSchema: z.object({
        subject_id: z.number().int().positive(),
        itemid: z.number().int().positive()
      })
    },
    async ({ subject_id, itemid }) => toolTextResult(await queries.getLatestLab(subject_id, itemid))
  );

  server.registerTool(
    "lab_history",
    {
      title: "Lab History",
      description: "Get lab history for a subject and itemid (limited).",
      inputSchema: z.object({
        subject_id: z.number().int().positive(),
        itemid: z.number().int().positive(),
        limit: z.number().int().positive().max(50_000).optional()
      })
    },
    async ({ subject_id, itemid, limit }) =>
      toolTextResult(await queries.getLabHistory(subject_id, itemid, limit ?? 5000))
  );

  server.registerTool(
    "diagnoses",
    {
      title: "Diagnoses",
      description: "List diagnoses (ICD) for a subject_id (joined to titles).",
      inputSchema: z.object({
        subject_id: z.number().int().positive()
      })
    },
    async ({ subject_id }) => toolTextResult(await queries.getDiagnoses(subject_id))
  );

  server.registerTool(
    "medications",
    {
      title: "Medications",
      description:
        "List prescriptions (limited). Use prescription_filter=glycemic for insulin/OAD/SGLT2/etc. (same rule as glycemic benchmark tasks).",
      inputSchema: z.object({
        subject_id: z.number().int().positive(),
        limit: z.number().int().positive().max(50_000).optional(),
        prescription_filter: z.enum(["all", "glycemic"]).optional()
      })
    },
    async ({ subject_id, limit, prescription_filter }) =>
      toolTextResult(
        await queries.getMedications(subject_id, limit ?? 5000, {
          prescriptionFilter: prescription_filter ?? "all"
        })
      )
  );

  server.registerTool(
    "add_patient_note",
    {
      title: "Add patient note",
      description:
        "Append a free-text note to the patient chart. Fails if subject_id is not in the database. Use for documentation after reviewing labs, meds, or care plans.",
      inputSchema: z.object({
        subject_id: z.number().int().positive(),
        body: z.string().min(1).max(50_000),
        source: z.string().max(200).optional()
      })
    },
    async ({ subject_id, body, source }) =>
      toolTextResult(await queries.addPatientNote(subject_id, body, source ?? "mcp"))
  );

  server.registerTool(
    "patient_notes",
    {
      title: "List patient notes",
      description: "Notes previously saved for this patient (newest first).",
      inputSchema: z.object({
        subject_id: z.number().int().positive(),
        limit: z.number().int().positive().max(500).optional()
      })
    },
    async ({ subject_id, limit }) =>
      toolTextResult(await queries.listPatientNotes(subject_id, limit ?? 100))
  );
}
