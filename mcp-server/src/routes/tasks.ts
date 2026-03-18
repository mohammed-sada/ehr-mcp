import { z } from "zod";
import * as q from "../db/queries.js";

const SubjectIdSchema = z.coerce.number().int().positive();
const ItemIdSchema = z.coerce.number().int().positive();
const LimitSchema = z.coerce.number().int().positive().max(50_000).default(5000);

export type TaskRouteResult =
  | { ok: true; data: unknown }
  | { ok: false; error: { message: string; details?: unknown } };

function ok(data: unknown): TaskRouteResult {
  return { ok: true, data };
}

function fail(message: string, details?: unknown): TaskRouteResult {
  return { ok: false, error: { message, details } };
}

export async function handleTask(pathname: string, searchParams: URLSearchParams): Promise<TaskRouteResult> {
  try {
    if (pathname === "/patient-info") {
      const subjectId = SubjectIdSchema.parse(searchParams.get("subject_id"));
      return ok(await q.getPatientInfo(subjectId));
    }

    if (pathname === "/latest-lab") {
      const subjectId = SubjectIdSchema.parse(searchParams.get("subject_id"));
      const itemid = ItemIdSchema.parse(searchParams.get("itemid"));
      return ok(await q.getLatestLab(subjectId, itemid));
    }

    if (pathname === "/lab-history") {
      const subjectId = SubjectIdSchema.parse(searchParams.get("subject_id"));
      const itemid = ItemIdSchema.parse(searchParams.get("itemid"));
      const limit = LimitSchema.parse(searchParams.get("limit"));
      return ok(await q.getLabHistory(subjectId, itemid, limit));
    }

    if (pathname === "/diagnoses") {
      const subjectId = SubjectIdSchema.parse(searchParams.get("subject_id"));
      return ok(await q.getDiagnoses(subjectId));
    }

    if (pathname === "/medications") {
      const subjectId = SubjectIdSchema.parse(searchParams.get("subject_id"));
      const limit = LimitSchema.parse(searchParams.get("limit"));
      return ok(await q.getMedications(subjectId, limit));
    }

    return fail("Not found");
  } catch (err) {
    if (err instanceof z.ZodError) {
      return fail("Invalid query parameters", err.flatten());
    }
    return fail("Internal server error", err);
  }
}

