import { NextRequest, NextResponse } from "next/server"
import OpenAI, { toFile } from "openai"
import { adminDb, adminStorage } from "@/lib/firebase-admin"
import { v4 as uuidv4 } from "uuid"

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })

const STYLE_AND_SAFETY = `
[스타일 조건]
- 어린이 그림책 또는 2D 애니메이션 스타일
- flat 2D style, minimal shading, no lighting effects 반드시 포함
- 하이퍼리얼리즘, photorealism, 3D rendering 금지
- 부드럽고 명확한 라인, 따뜻한 파스텔 색감, 단순한 구성

[안전 조건 - 아래 요소가 포함된 경우 해당 요소를 제거하거나 안전한 방향으로 대체해]
- 폭력, 무기, 피, 상해 표현
- 선정적이거나 성적인 요소
- 공포, 혐오, 혐오스러운 생물
- 특정 인물(실존 인물, 유명인) 묘사
- 종교·정치적으로 민감한 내용

결과는 영어로, 반드시 아래처럼 시작해줘:
"A flat 2D illustration of..."
`

async function uploadToStorage(bytes: Buffer): Promise<string> {
  const filename = `images/${uuidv4()}.png`
  const bucket = adminStorage.bucket()
  const file = bucket.file(filename)
  await file.save(bytes, { contentType: "image/png" })
  await file.makePublic()
  return `https://storage.googleapis.com/${bucket.name}/${filename}`
}

export async function POST(req: NextRequest) {
  const { code, studentName, description, promptHistory, imageBase64, imageMimeType } =
    await req.json()

  if (!code || !studentName || !description) {
    return NextResponse.json({ error: "필수 항목이 누락되었습니다." }, { status: 400 })
  }

  const fullContext = (promptHistory as string[]).map((p) => `- ${p}`).join("\n")

  try {
    let imagePrompt: string
    let resultBytes: Buffer
    let originalImageUrl = ""

    if (imageBase64) {
      // ── 학생이 올린 그림을 변형 (이미지 → 이미지) ──
      const mime = (imageMimeType as string) || "image/png"
      const originalBytes = Buffer.from(imageBase64 as string, "base64")

      // ① gpt-4o(비전)가 원본 그림을 직접 보고, 안전한 변형 지시문을 만든다
      const visionPrompt = `
너는 초등학교 수업용 AI 그림 편집 도구의 프롬프트 전문가야.
아래에 학생이 올린 '원본 그림'이 있고, 학생의 요청(누적 흐름)이 있어.
원본의 핵심 형태와 구성은 최대한 살리되, 요청한 변화를 반영하는
gpt-image-1 image edit 모델용 영어 지시문 한 문단을 만들어줘.
이 결과물은 선생님이 검토 후 학생에게 공개되는 교육용 콘텐츠야.

학생의 요청 (누적 흐름):
${fullContext}
${STYLE_AND_SAFETY}
`
      const visionRes = await client.chat.completions.create({
        model: "gpt-4o",
        messages: [
          { role: "system", content: "너는 초등학교 교육용 이미지 편집 프롬프트 전문가야." },
          {
            role: "user",
            content: [
              { type: "text", text: visionPrompt },
              { type: "image_url", image_url: { url: `data:${mime};base64,${imageBase64}` } },
            ],
          },
        ],
      })
      imagePrompt = visionRes.choices[0].message.content!.trim()

      // ② gpt-image-1 edit 로 원본을 변형
      const inputFile = await toFile(originalBytes, "input.png", { type: "image/png" })
      const editRes = await client.images.edit({
        model: "gpt-image-1",
        image: inputFile,
        prompt: imagePrompt,
        size: "1024x1024",
      })
      resultBytes = Buffer.from((editRes.data![0] as { b64_json: string }).b64_json, "base64")

      // 원본도 보관 (선생님 재생성 시 다시 변형할 수 있도록)
      originalImageUrl = await uploadToStorage(originalBytes)
    } else {
      // ── 글 설명만으로 새 그림 생성 (기존 동작) ──
      const gptPrompt = `
너는 초등학교 수업에서 활용하는 AI 그림 생성 도구의 프롬프트 전문가야.
초등학생(7~13세)이 입력한 설명을 바탕으로, gpt-image-1이 이해할 수 있는 영어 프롬프트를 만들어줘.
이 그림은 선생님이 검토 후 학생에게 공개되는 교육용 콘텐츠야.

학생의 설명 (누적 흐름):
${fullContext}
${STYLE_AND_SAFETY}
`
      const gptResponse = await client.chat.completions.create({
        model: "gpt-4o",
        messages: [
          { role: "system", content: "너는 이미지 생성 전문 프롬프트 엔지니어야." },
          { role: "user", content: gptPrompt },
        ],
      })
      imagePrompt = gptResponse.choices[0].message.content!.trim()

      const imageResponse = await client.images.generate({
        model: "gpt-image-1",
        prompt: imagePrompt,
        size: "1024x1024",
        n: 1,
      })
      resultBytes = Buffer.from(
        (imageResponse.data![0] as { b64_json: string }).b64_json,
        "base64"
      )
    }

    const imageUrl = await uploadToStorage(resultBytes)

    const docRef = await adminDb.collection("requests").add({
      code,
      studentName,
      description,
      imagePrompt,
      imageUrl,
      originalImageUrl,
      status: "pending",
      createdAt: Date.now(),
    })

    return NextResponse.json({ id: docRef.id, imageUrl })
  } catch (e: unknown) {
    console.error(e)
    const message = e instanceof Error ? e.message : "알 수 없는 오류"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
