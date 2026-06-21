import OpenAI, { toFile } from "openai"
import { adminStorage } from "@/lib/firebase-admin"
import { v4 as uuidv4 } from "uuid"

/**
 * Sora 2 영상 생성 핵심 로직 (재사용 가능).
 *
 * 흐름: startVideo(잡 생성) → getVideo(상태 폴링) → storeVideo(mp4 저장).
 * 영상은 수십 초~수 분이 걸리므로, 한 요청에서 끝까지 기다리지 않고
 * "잡 생성 → 폴링 → 다운로드"로 나눠서 호출한다.
 *
 * 나중에 safeimage 본 서비스(교사 승인 흐름 등)에 그대로 import 해서 쓰면 된다.
 */

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })

export type VideoModel = "sora-2" | "sora-2-pro"
export type VideoSeconds = "4" | "8" | "12"
export type VideoSize = "720x1280" | "1280x720" | "1024x1792" | "1792x1024"

export interface StartVideoInput {
  prompt: string
  model?: VideoModel
  seconds?: VideoSeconds
  size?: VideoSize
  /** 이미지→영상일 때 참조 이미지 바이트. 없으면 텍스트→영상. */
  imageBytes?: Buffer
  imageMime?: string
}

/** 영상 생성 잡을 시작한다. 반환된 id 로 이후 상태를 폴링한다. */
export async function startVideo(input: StartVideoInput) {
  const { prompt, model = "sora-2", seconds = "4", size = "720x1280", imageBytes, imageMime } = input

  const body: Parameters<typeof client.videos.create>[0] = {
    prompt,
    model,
    seconds,
    size,
  }

  if (imageBytes) {
    // input_reference: 참조 이미지로 영상을 만든다 (이미지→영상).
    // ⚠️ Sora 는 참조 이미지 해상도가 size 와 일치해야 한다.
    body.input_reference = await toFile(imageBytes, "reference.png", {
      type: imageMime || "image/png",
    })
  }

  return client.videos.create(body)
}

/** 영상 잡의 현재 상태/진행률을 조회한다. */
export async function getVideo(videoId: string) {
  return client.videos.retrieve(videoId)
}

/**
 * 완료된 영상의 mp4 바이트를 내려받아 Firebase Storage 에 올리고 공개 URL 을 반환한다.
 * status 가 "completed" 일 때만 호출할 것.
 */
export async function storeVideo(videoId: string): Promise<string> {
  const res = await client.videos.downloadContent(videoId, { variant: "video" })
  const bytes = Buffer.from(await res.arrayBuffer())

  const filename = `videos/${uuidv4()}.mp4`
  const bucket = adminStorage.bucket()
  const file = bucket.file(filename)
  await file.save(bytes, { contentType: "video/mp4" })
  await file.makePublic()
  return `https://storage.googleapis.com/${bucket.name}/${filename}`
}
