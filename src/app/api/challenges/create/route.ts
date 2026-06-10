import { NextRequest, NextResponse } from "next/server"
import { adminDb, adminStorage } from "@/lib/firebase-admin"
import { v4 as uuidv4 } from "uuid"

export async function POST(req: NextRequest) {
  const { code, title, attemptLimit, allowUpload, imageBase64 } = await req.json()

  if (!code || !title || !attemptLimit || !imageBase64) {
    return NextResponse.json({ error: "필수 항목이 누락되었습니다." }, { status: 400 })
  }

  try {
    // 같은 코드의 챌린지가 이미 있으면 막는다 (실수 덮어쓰기 방지)
    const existing = await adminDb.collection("challenges").doc(code).get()
    if (existing.exists) {
      return NextResponse.json({ error: "이미 같은 코드의 챌린지가 있어요." }, { status: 409 })
    }

    const targetBytes = Buffer.from(imageBase64 as string, "base64")
    const filename = `images/${uuidv4()}.png`
    const bucket = adminStorage.bucket()
    const file = bucket.file(filename)
    await file.save(targetBytes, { contentType: "image/png" })
    await file.makePublic()
    const targetImageUrl = `https://storage.googleapis.com/${bucket.name}/${filename}`

    await adminDb.collection("challenges").doc(code).set({
      code,
      title,
      targetImageUrl,
      attemptLimit: Number(attemptLimit),
      allowUpload: !!allowUpload,
      createdAt: Date.now(),
    })

    return NextResponse.json({ code, targetImageUrl })
  } catch (e: unknown) {
    console.error(e)
    const message = e instanceof Error ? e.message : "알 수 없는 오류"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
