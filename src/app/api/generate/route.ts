import { NextRequest, NextResponse } from "next/server"
import OpenAI, { toFile } from "openai"
import { adminDb, adminStorage } from "@/lib/firebase-admin"
import { v4 as uuidv4 } from "uuid"

// 여러 OpenAI 키를 콤마로 받아 풀로 사용. 요청마다 랜덤 시작점에서 순환하며,
// 429(rate limit)나 5xx가 나면 다음 키로 자동 재시도해 순간 부하를 분산한다.
// (효과는 키가 '서로 다른 계정'일 때만 큼 — 같은 계정 키는 한도를 공유함)
const OPENAI_KEYS = (process.env.OPENAI_API_KEYS ?? process.env.OPENAI_API_KEY ?? "")
  .split(",")
  .map((k) => k.trim())
  .filter(Boolean)

function clientFor(key: string): OpenAI {
  return new OpenAI({ apiKey: key })
}

async function withKeyFailover<T>(fn: (client: OpenAI) => Promise<T>): Promise<T> {
  if (OPENAI_KEYS.length === 0) {
    throw new Error("OPENAI_API_KEYS(또는 OPENAI_API_KEY)가 설정되지 않았습니다.")
  }
  const start = Math.floor(Math.random() * OPENAI_KEYS.length)
  let lastErr: unknown
  for (let i = 0; i < OPENAI_KEYS.length; i++) {
    const key = OPENAI_KEYS[(start + i) % OPENAI_KEYS.length]
    try {
      return await fn(clientFor(key))
    } catch (e) {
      const status = (e as { status?: number })?.status
      // rate limit / 서버 오류만 다음 키로 재시도. 그 외(400 등)는 즉시 실패.
      if (status === 429 || (typeof status === "number" && status >= 500)) {
        lastErr = e
        continue
      }
      throw e
    }
  }
  throw lastErr
}

// 안전 규칙: 항상 적용되는 부분 (교사가 못 끔)
const SAFETY_RULES = `
[안전 규칙 - 아래 요소가 포함된 경우 해당 요소를 제거하거나 안전한 방향으로 대체해]
- 폭력, 무기, 피, 상해 표현
- 선정적이거나 성적인 요소
- 공포, 혐오스러운 생물
- 특정 인물(실존 인물, 유명인) 묘사
- 종교·정치적으로 민감한 내용
`

// 스타일 안내: 화풍을 강제하지 않고 학생의 상상/요청을 따른다 (추후 교사 커스텀이 얹힐 자리)
const STYLE_GUIDE = `
[스타일 안내]
- 학생이 상상한 내용을 자유로운 스타일로 표현해줘. 특정 화풍을 강제하지 마.
- 학생이 스타일을 직접 요청하면(예: 사실적, 3D, 만화, 픽셀아트, 수채화, 애니메이션) 그대로 따라줘.
- 어린이가 보기에 즐겁고 창의적인 결과를 지향해.

결과는 영어 프롬프트로 만들어줘.
`

// gpt-image-1은 1024x1024 / 1536x1024(가로) / 1024x1536(세로) 세 가지만 지원.
// 업로드한 그림의 가로세로 비율을 보고 가장 가까운 크기를 고른다.
function pickSize(w?: number, h?: number): "1024x1024" | "1536x1024" | "1024x1536" {
  if (!w || !h) return "1024x1024"
  const r = w / h
  if (r >= 1.2) return "1536x1024" // 가로형
  if (r <= 0.83) return "1024x1536" // 세로형
  return "1024x1024" // 정사각형에 가까움
}

async function uploadToStorage(bytes: Buffer): Promise<string> {
  const filename = `images/${uuidv4()}.png`
  const bucket = adminStorage.bucket()
  const file = bucket.file(filename)
  await file.save(bytes, { contentType: "image/png" })
  await file.makePublic()
  return `https://storage.googleapis.com/${bucket.name}/${filename}`
}

export async function POST(req: NextRequest) {
  const {
    code,
    studentName,
    description,
    promptHistory,
    imageBase64,
    imageMimeType,
    imageWidth,
    imageHeight,
  } = await req.json()

  if (!code || !studentName || !description) {
    return NextResponse.json({ error: "필수 항목이 누락되었습니다." }, { status: 400 })
  }

  const fullContext = (promptHistory as string[]).map((p) => `- ${p}`).join("\n")

  // ── 챌린지 모드면 잠금/시도한도/첨부허용 사전 체크 ──
  let challenge: { allowUpload: boolean; attemptLimit: number } | null = null
  try {
    const chSnap = await adminDb.collection("challenges").doc(code).get()
    if (chSnap.exists) {
      const data = chSnap.data()!
      challenge = { allowUpload: !!data.allowUpload, attemptLimit: Number(data.attemptLimit) }

      const pSnap = await adminDb
        .collection("challenges").doc(code)
        .collection("participants").doc(studentName)
        .get()
      const p = pSnap.data() as { attemptsUsed?: number; locked?: boolean } | undefined
      if (p?.locked) {
        return NextResponse.json({ error: "이미 챌린지가 끝났어요." }, { status: 400 })
      }
      if ((p?.attemptsUsed ?? 0) >= challenge.attemptLimit) {
        return NextResponse.json({ error: "시도 횟수를 모두 사용했어요." }, { status: 400 })
      }
      if (!challenge.allowUpload && imageBase64) {
        return NextResponse.json({ error: "이 챌린지는 그림 첨부를 사용할 수 없어요." }, { status: 400 })
      }
    }
  } catch (e) {
    console.error("challenge precheck failed", e)
  }

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
${SAFETY_RULES}
${STYLE_GUIDE}
`
      const visionRes = await withKeyFailover((c) =>
        c.chat.completions.create({
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
      )
      imagePrompt = visionRes.choices[0].message.content!.trim()

      // ② gpt-image-1 edit 로 원본을 변형
      const inputFile = await toFile(originalBytes, "input.png", { type: "image/png" })
      const editRes = await withKeyFailover((c) =>
        c.images.edit({
          model: "gpt-image-1",
          image: inputFile,
          prompt: imagePrompt,
          size: pickSize(Number(imageWidth), Number(imageHeight)),
        })
      )
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
${SAFETY_RULES}
${STYLE_GUIDE}
`
      const gptResponse = await withKeyFailover((c) =>
        c.chat.completions.create({
          model: "gpt-4o",
          messages: [
            { role: "system", content: "너는 이미지 생성 전문 프롬프트 엔지니어야." },
            { role: "user", content: gptPrompt },
          ],
        })
      )
      imagePrompt = gptResponse.choices[0].message.content!.trim()

      const imageResponse = await withKeyFailover((c) =>
        c.images.generate({
          model: "gpt-image-1",
          prompt: imagePrompt,
          size: "1024x1024",
          n: 1,
        })
      )
      resultBytes = Buffer.from(
        (imageResponse.data![0] as { b64_json: string }).b64_json,
        "base64"
      )
    }

    const imageUrl = await uploadToStorage(resultBytes)

    const docData: Record<string, unknown> = {
      code,
      studentName,
      description,
      imagePrompt,
      imageUrl,
      originalImageUrl,
      status: "pending",
      createdAt: Date.now(),
    }
    if (challenge) docData.challengeCode = code
    const docRef = await adminDb.collection("requests").add(docData)

    return NextResponse.json({ id: docRef.id, imageUrl })
  } catch (e: unknown) {
    console.error(e)
    const message = e instanceof Error ? e.message : "알 수 없는 오류"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
