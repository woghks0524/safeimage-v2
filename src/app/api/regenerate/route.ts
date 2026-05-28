import { NextRequest, NextResponse } from "next/server"
import OpenAI from "openai"
import { adminDb, adminStorage } from "@/lib/firebase-admin"
import { v4 as uuidv4 } from "uuid"

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })

export async function POST(req: NextRequest) {
  const { id, description } = await req.json()
  if (!id || !description) return NextResponse.json({ error: "필수 항목 누락" }, { status: 400 })

  const gptPrompt = `
너는 초등학교 수업에서 활용하는 AI 그림 생성 도구의 프롬프트 전문가야.
선생님이 학생의 그림 요청을 재생성하려고 해. 아래 학생의 설명을 바탕으로 새로운 영어 프롬프트를 만들어줘.

학생의 설명: ${description}

[스타일 조건]
- 어린이 그림책 또는 2D 애니메이션 스타일
- flat 2D style, minimal shading, no lighting effects 반드시 포함
- 하이퍼리얼리즘, photorealism, 3D rendering 금지
- 부드럽고 명확한 라인, 따뜻한 파스텔 색감, 단순한 구성

[안전 조건 - 아래 요소가 포함된 경우 제거하거나 안전한 방향으로 대체해]
- 폭력, 무기, 피, 상해 표현
- 선정적이거나 성적인 요소
- 공포, 혐오, 혐오스러운 생물
- 특정 실존 인물 묘사
- 종교·정치적으로 민감한 내용

결과는 영어로, 반드시 아래처럼 시작해줘:
"A flat 2D illustration of..."
`

  try {
    const gptResponse = await client.chat.completions.create({
      model: "gpt-4o",
      messages: [
        { role: "system", content: "너는 초등학교 교육용 이미지 생성 프롬프트 전문가야." },
        { role: "user", content: gptPrompt },
      ],
    })

    const imagePrompt = gptResponse.choices[0].message.content!.trim()

    const imageResponse = await client.images.generate({
      model: "gpt-image-1",
      prompt: imagePrompt,
      size: "1024x1024",
      n: 1,
    })

    const imageBase64 = (imageResponse.data![0] as { b64_json: string }).b64_json
    const imageBytes = Buffer.from(imageBase64, "base64")

    const filename = `images/${uuidv4()}.png`
    const bucket = adminStorage.bucket()
    const file = bucket.file(filename)
    await file.save(imageBytes, { contentType: "image/png" })
    await file.makePublic()
    const imageUrl = `https://storage.googleapis.com/${bucket.name}/${filename}`

    await adminDb.collection("requests").doc(id).update({ imageUrl, approved: false })

    return NextResponse.json({ imageUrl })
  } catch (e: unknown) {
    console.error(e)
    const message = e instanceof Error ? e.message : "알 수 없는 오류"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
