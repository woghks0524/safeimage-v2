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

// 영상 프롬프트 공통 안전·연출 규칙 (이미지의 STYLE_AND_SAFETY 와 같은 역할)
const VIDEO_SAFETY_AND_STYLE = `
[안전 규칙 - 아래 요소가 포함된 경우 제거하거나 안전한 방향으로 대체해]
- 폭력, 무기, 피, 상해 표현
- 선정적이거나 성적인 요소
- 공포, 혐오스러운 생물
- 특정 인물(실존 인물, 유명인) 묘사
- 종교·정치적으로 민감한 내용

[스타일/연출 안내]
- 초등학생이 보기에 밝고 친근하며 즐거운 분위기로.
- 학생이 특정 스타일을 요청하면 그대로 따르고, 없으면 자유롭게 표현해.
- 영상이므로 움직임과 동작을 구체적으로 묘사해줘.

결과는 Sora 영상 모델용 영어 프롬프트 한 문단으로만 답해줘.
`

/**
 * 초등학생 입력을 Sora 용 안전한 영어 프롬프트로 정제한다 (이미지의 GPT-4o 단계와 동일).
 * 그림이 있으면 GPT-4o 비전이 그림을 직접 보고 "움직이는 영상" 지시문을 만든다.
 */
export async function refineVideoPrompt(input: {
  prompt: string
  imageBytes?: Buffer
  imageMime?: string
}): Promise<string> {
  const { prompt, imageBytes, imageMime } = input

  if (imageBytes) {
    const mime = imageMime || "image/png"
    const b64 = imageBytes.toString("base64")
    const res = await client.chat.completions.create({
      model: "gpt-4o",
      messages: [
        { role: "system", content: "너는 초등학교 교육용 영상 프롬프트 전문가야." },
        {
          role: "user",
          content: [
            {
              type: "text",
              text: `아래는 학생이 올린 그림이야. 이 그림이 자연스럽게 움직이는 짧은 영상을 만들기 위한 프롬프트를 만들어줘. 원본의 핵심 형태와 구성은 유지하되, 학생의 요청을 반영해.
학생 요청: ${prompt}
${VIDEO_SAFETY_AND_STYLE}`,
            },
            { type: "image_url", image_url: { url: `data:${mime};base64,${b64}` } },
          ],
        },
      ],
    })
    return res.choices[0].message.content!.trim()
  }

  const res = await client.chat.completions.create({
    model: "gpt-4o",
    messages: [
      { role: "system", content: "너는 초등학교 교육용 영상 프롬프트 전문가야." },
      {
        role: "user",
        content: `초등학생(7~13세)이 입력한 설명을 Sora 영상 모델용 영어 프롬프트로 바꿔줘.
이 영상은 선생님이 검토 후 학생에게 공개되는 교육용 콘텐츠야.
학생 설명: ${prompt}
${VIDEO_SAFETY_AND_STYLE}`,
      },
    ],
  })
  return res.choices[0].message.content!.trim()
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
