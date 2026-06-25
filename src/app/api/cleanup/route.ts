import { NextRequest, NextResponse } from "next/server"
import { adminDb, adminStorage } from "@/lib/firebase-admin"

/**
 * 오래된 결과물 자동 정리 (Vercel Cron 이 매일 호출).
 *  - requests 문서가 RETENTION_DAYS 보다 오래되면 → 그 영상/이미지/원본 파일과 문서를 삭제
 *  - 문서 없는 오래된 영상 파일(테스트 산출물 등)도 정리 (videos/ 는 챌린지가 사용 안 함)
 *  - 챌린지 목표 이미지는 requests 가 아니므로 삭제되지 않음 (보존)
 *
 * 인증: CRON_SECRET 이 설정돼 있으면 Vercel Cron 이 보내는 Bearer 토큰을 검증.
 * 미리보기: /api/cleanup?dryRun=1 → 실제 삭제 없이 대상 개수만 반환.
 */

export const dynamic = "force-dynamic"
export const maxDuration = 60

const RETENTION_DAYS = 14

function objectPath(url: string, bucketName: string): string | null {
  const prefix = `https://storage.googleapis.com/${bucketName}/`
  return url.startsWith(prefix) ? decodeURIComponent(url.slice(prefix.length)) : null
}

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET
  if (secret) {
    const auth = req.headers.get("authorization")
    if (auth !== `Bearer ${secret}`) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 })
    }
  }

  const dryRun = req.nextUrl.searchParams.get("dryRun") === "1"
  const cutoff = Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000
  const bucket = adminStorage.bucket()
  let deletedFiles = 0
  let deletedDocs = 0

  try {
    // 1) 오래된 요청 문서 + 그 파일(영상/이미지/원본)
    const snap = await adminDb.collection("requests").where("createdAt", "<", cutoff).get()
    for (const docSnap of snap.docs) {
      const d = docSnap.data()
      for (const url of [d.videoUrl, d.imageUrl, d.originalImageUrl]) {
        if (typeof url === "string" && url) {
          const path = objectPath(url, bucket.name)
          if (path) {
            if (!dryRun) await bucket.file(path).delete({ ignoreNotFound: true })
            deletedFiles++
          }
        }
      }
      if (!dryRun) await docSnap.ref.delete()
      deletedDocs++
    }

    // 2) 문서 없는 오래된 영상 파일 정리
    const [videoFiles] = await bucket.getFiles({ prefix: "videos/" })
    for (const f of videoFiles) {
      const tc = f.metadata.timeCreated as string | undefined
      const created = tc ? new Date(tc).getTime() : 0
      if (created && created < cutoff) {
        if (!dryRun) await f.delete({ ignoreNotFound: true })
        deletedFiles++
      }
    }

    return NextResponse.json({ ok: true, dryRun, retentionDays: RETENTION_DAYS, deletedDocs, deletedFiles })
  } catch (e: unknown) {
    console.error(e)
    const message = e instanceof Error ? e.message : "알 수 없는 오류"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
