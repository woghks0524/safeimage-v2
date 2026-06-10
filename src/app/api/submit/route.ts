import { NextRequest, NextResponse } from "next/server"
import { adminDb } from "@/lib/firebase-admin"

export async function POST(req: NextRequest) {
  const { code, studentName } = await req.json()
  if (!code || !studentName) {
    return NextResponse.json({ error: "필수 항목 누락" }, { status: 400 })
  }

  const participantRef = adminDb
    .collection("challenges").doc(code)
    .collection("participants").doc(studentName)

  const pSnap = await participantRef.get()
  const submittedRequestId = pSnap.data()?.submittedRequestId as string | undefined

  if (!submittedRequestId) {
    return NextResponse.json({ error: "아직 승인된 그림이 없어요. 그림을 한 번 받고 제출해 주세요." }, { status: 400 })
  }

  await participantRef.set(
    { locked: true, submittedAt: Date.now() },
    { merge: true }
  )

  return NextResponse.json({ ok: true, submittedRequestId })
}
