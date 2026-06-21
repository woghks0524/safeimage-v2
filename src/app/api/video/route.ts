import { NextRequest, NextResponse } from "next/server"
import { startVideo, getVideo, storeVideo } from "@/lib/video"
import type { VideoModel, VideoSeconds, VideoSize } from "@/lib/video"

/**
 * 영상 생성 테스트 라우트.
 *  - POST /api/video        → 잡 시작, { id } 반환
 *  - GET  /api/video?id=... → 상태 폴링. 완료되면 mp4 저장 후 { status, videoUrl } 반환
 *
 * 본 서비스(safeimage)와 분리된 테스트 전용 엔드포인트.
 */

export async function POST(req: NextRequest) {
  try {
    const { prompt, model, seconds, size, imageBase64, imageMimeType } = await req.json()

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

    return NextResponse.json({ id: video.id, status: video.status })
  } catch (e: unknown) {
    console.error(e)
    const message = e instanceof Error ? e.message : "알 수 없는 오류"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

export async function GET(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("id")
  if (!id) {
    return NextResponse.json({ error: "id 가 필요합니다." }, { status: 400 })
  }

  try {
    const video = await getVideo(id)

    if (video.status === "failed") {
      return NextResponse.json({
        status: "failed",
        error: video.error?.message ?? "영상 생성에 실패했어요.",
      })
    }

    if (video.status === "completed") {
      const videoUrl = await storeVideo(id)
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
