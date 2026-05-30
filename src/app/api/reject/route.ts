import { NextRequest, NextResponse } from "next/server"
import { adminDb } from "@/lib/firebase-admin"

export async function POST(req: NextRequest) {
  const { id, message } = await req.json()
  if (!id) return NextResponse.json({ error: "id 누락" }, { status: 400 })

  const update: Record<string, unknown> = { status: "rejected" }
  if (typeof message === "string" && message.trim()) {
    update.rejectMessage = message.trim()
  }
  await adminDb.collection("requests").doc(id).update(update)
  return NextResponse.json({ ok: true })
}
