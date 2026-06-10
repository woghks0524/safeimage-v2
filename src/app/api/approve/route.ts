import { NextRequest, NextResponse } from "next/server"
import { adminDb } from "@/lib/firebase-admin"
import { FieldValue } from "firebase-admin/firestore"

export async function POST(req: NextRequest) {
  const { id } = await req.json()
  if (!id) return NextResponse.json({ error: "id 누락" }, { status: 400 })

  // 요청 문서를 먼저 읽어 챌린지 연관 여부를 확인
  const reqRef = adminDb.collection("requests").doc(id)
  const reqSnap = await reqRef.get()
  if (!reqSnap.exists) return NextResponse.json({ error: "요청 없음" }, { status: 404 })

  const data = reqSnap.data()!
  await reqRef.update({ status: "approved" })

  const challengeCode = data.challengeCode as string | undefined
  const studentName = data.studentName as string | undefined

  // 챌린지 모드면: 시도 1회 차감, 한도 도달 시 마지막 승인본을 자동 제출
  if (challengeCode && studentName) {
    const chSnap = await adminDb.collection("challenges").doc(challengeCode).get()
    if (chSnap.exists) {
      const attemptLimit = Number(chSnap.data()!.attemptLimit) || 0
      const participantRef = adminDb
        .collection("challenges").doc(challengeCode)
        .collection("participants").doc(studentName)

      await participantRef.set(
        { attemptsUsed: FieldValue.increment(1), submittedRequestId: id },
        { merge: true }
      )

      // 한도 도달 → 자동 제출 + 잠금
      const updated = await participantRef.get()
      const used = (updated.data()?.attemptsUsed as number) || 0
      if (used >= attemptLimit) {
        await participantRef.set(
          { locked: true, submittedAt: Date.now() },
          { merge: true }
        )
      }
    }
  }

  return NextResponse.json({ ok: true })
}
