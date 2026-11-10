import "server-only";
import { NextResponse } from "next/server";

import type { AdminResult } from "@/lib/server/admin";

export async function respond(pending: Promise<AdminResult>, created = false) {
  const result = await pending;
  if (result.ok) return NextResponse.json(result.value, { status: created ? 201 : 200 });
  if (result.status === 422) return NextResponse.json({ error: "invalid", violations: result.violations }, { status: 422 });
  return NextResponse.json({ error: result.status === 404 ? "not found" : "conflict", reason: result.reason }, { status: result.status });
}
