import { NextRequest, NextResponse } from "next/server"
import { adminDb } from "@/lib/firebase-admin"

export async function POST(req: NextRequest) {
  const { id } = await req.json()
  if (!id) return NextResponse.json({ error: "id 누락" }, { status: 400 })

  await adminDb.collection("requests").doc(id).update({ status: "rejected" })
  return NextResponse.json({ ok: true })
}
