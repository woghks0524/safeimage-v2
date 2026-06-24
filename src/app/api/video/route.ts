import { NextRequest, NextResponse } from "next/server"
import { startVideo, getVideo, storeVideo } from "@/lib/video"
import type { VideoModel, VideoSeconds, VideoSize } from "@/lib/video"
import { adminDb } from "@/lib/firebase-admin"

/**
 * 영상 생성 라우트 (이미지와 동일한 교사 승인 흐름).
 *  - POST /api/video        → 잡 시작. code+studentName 이 오면 requests 문서(status:"generating") 생성 → { id, requestId }
 *  - GET  /api/video?id=&requestId= → 폴링. 완료 시 mp4 저장 + 문서를 status:"pending" 으로 올려 교사 승인 대기열에 등록
 *
 * code/studentName 없이 호출하면(=테스트 페이지) 문서를 만들지 않고 단순 생성만 한다.
 */

export async function POST(req: NextRequest) {
  try {
    const { prompt, model, seconds, size, imageBase64, imageMimeType, code, studentName, description } =
      await req.json()

    if (!prompt || typeof prompt !== "string") {
      return NextResponse.json({ error: "프롬프트가 필요합니다." }, { status: 400 })
    }

    const video = await startVideo({
      prompt,
      model: model as VideoModel | undefined,
      seconds: seconds as VideoSeconds | undefined,
      size: size as VideoSize | undefined,
      imageBytes: imageBase64 ? Buffer.from(imageBase64 as string, "base64") : undefined,
      imageMime: imageMimeType as string | undefined,
    })

    // 본 서비스 흐름: 승인 대기에 올릴 요청 문서를 미리 만든다 (완료 전이라 status:"generating")
    let requestId: string | undefined
    if (code && studentName) {
      const docRef = await adminDb.collection("requests").add({
        code,
        studentName,
        description: description || prompt,
        imagePrompt: prompt,
        imageUrl: "",
        videoUrl: "",
        mediaType: "video",
        videoId: video.id,
        status: "generating",
        createdAt: Date.now(),
      })
      requestId = docRef.id
    }

    return NextResponse.json({ id: video.id, requestId, status: video.status })
  } catch (e: unknown) {
    console.error(e)
    const message = e instanceof Error ? e.message : "알 수 없는 오류"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

export async function GET(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("id")
  const requestId = req.nextUrl.searchParams.get("requestId")
  if (!id) {
    return NextResponse.json({ error: "id 가 필요합니다." }, { status: 400 })
  }

  try {
    // 이미 저장이 끝난 요청이면 다시 다운로드하지 않고 그대로 반환 (중복 폴링 방어)
    if (requestId) {
      const snap = await adminDb.collection("requests").doc(requestId).get()
      const existing = snap.data()
      if (existing?.videoUrl) {
        return NextResponse.json({ status: "completed", progress: 100, videoUrl: existing.videoUrl })
      }
    }

    const video = await getVideo(id)

    if (video.status === "failed") {
      if (requestId) {
        await adminDb.collection("requests").doc(requestId).update({
          status: "rejected",
          rejectMessage: video.error?.message ?? "영상 생성에 실패했어요.",
        })
      }
      return NextResponse.json({
        status: "failed",
        error: video.error?.message ?? "영상 생성에 실패했어요.",
      })
    }

    if (video.status === "completed") {
      const videoUrl = await storeVideo(id)
      // 완료 → 승인 대기열에 등록 (교사 페이지의 pending 목록에 표시됨)
      if (requestId) {
        await adminDb.collection("requests").doc(requestId).update({ videoUrl, status: "pending" })
      }
      return NextResponse.json({ status: "completed", progress: 100, videoUrl })
    }

    // queued | in_progress
    return NextResponse.json({ status: video.status, progress: video.progress ?? 0 })
  } catch (e: unknown) {
    console.error(e)
    const message = e instanceof Error ? e.message : "알 수 없는 오류"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
