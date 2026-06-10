"use client"

import { useState, useRef } from "react"
import Link from "next/link"

// 목표 이미지를 최대 1024px PNG 데이터 URL로 축소 (학생 생성 결과와 크기 정렬)
async function fileToDownscaledPng(file: File, max = 1024): Promise<string> {
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const im = new window.Image()
    im.onload = () => resolve(im)
    im.onerror = reject
    im.src = dataUrl
  })
  const scale = Math.min(1, max / Math.max(img.width, img.height))
  const w = Math.round(img.width * scale)
  const h = Math.round(img.height * scale)
  const canvas = document.createElement("canvas")
  canvas.width = w
  canvas.height = h
  canvas.getContext("2d")!.drawImage(img, 0, 0, w, h)
  return canvas.toDataURL("image/png")
}

export default function ChallengeCreatePage() {
  const [code, setCode] = useState("")
  const [title, setTitle] = useState("")
  const [attemptLimit, setAttemptLimit] = useState("3")
  const [allowUpload, setAllowUpload] = useState(false)
  const [targetImage, setTargetImage] = useState<string | null>(null) // data URL
  const [status, setStatus] = useState<"idle" | "creating" | "done">("idle")
  const [error, setError] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  const pickImage = async (file: File | null | undefined) => {
    if (!file) return
    setError(null)
    try {
      setTargetImage(await fileToDownscaledPng(file))
    } catch {
      setError("이미지를 읽지 못했어요. 다른 파일로 시도해 주세요.")
    }
  }

  const canSubmit =
    !!code.trim() && !!title.trim() && !!targetImage && Number(attemptLimit) > 0 && status === "idle"

  const handleCreate = async () => {
    if (!canSubmit || !targetImage) return
    setStatus("creating")
    setError(null)
    try {
      const res = await fetch("/api/challenges/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          code: code.trim(),
          title: title.trim(),
          attemptLimit: Number(attemptLimit),
          allowUpload,
          imageBase64: targetImage.split(",")[1],
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || "생성에 실패했어요.")
      setStatus("done")
    } catch (e) {
      setStatus("idle")
      setError(e instanceof Error ? e.message : "알 수 없는 오류가 발생했어요.")
    }
  }

  const resetForm = () => {
    setCode("")
    setTitle("")
    setAttemptLimit("3")
    setAllowUpload(false)
    setTargetImage(null)
    setStatus("idle")
    setError(null)
  }

  return (
    <div className="min-h-screen bg-sky-50">
      <header className="bg-white border-b border-sky-100 px-8 py-4 flex items-center gap-6">
        <div>
          <h1 className="text-xl font-bold text-sky-700">🎯 챌린지 만들기</h1>
          <p className="text-xs text-gray-400">목표 그림에 가깝게 그리는 미션을 만들어 보세요</p>
        </div>
        <Link href="/teacher" className="ml-auto text-sm text-sky-600 hover:underline">
          ← 승인 페이지로
        </Link>
      </header>

      <main className="p-8 max-w-xl mx-auto">
        {status === "done" ? (
          <div className="bg-white rounded-2xl border border-sky-100 shadow-sm p-8 text-center flex flex-col gap-4">
            <p className="text-2xl">✅</p>
            <p className="text-lg font-semibold text-gray-700">
              <span className="text-sky-600">&apos;{code.trim()}&apos;</span> 챌린지가 만들어졌어요!
            </p>
            <p className="text-sm text-gray-500">학생들에게 이 코드를 알려 주세요.</p>
            <div className="flex gap-2 justify-center mt-2">
              <button
                onClick={resetForm}
                className="bg-sky-500 hover:bg-sky-600 text-white text-sm font-semibold px-4 py-2 rounded-lg transition-colors"
              >
                새 챌린지 만들기
              </button>
              <Link
                href="/teacher"
                className="bg-gray-100 hover:bg-gray-200 text-gray-600 text-sm font-semibold px-4 py-2 rounded-lg transition-colors"
              >
                승인 페이지로
              </Link>
            </div>
          </div>
        ) : (
          <div className="bg-white rounded-2xl border border-sky-100 shadow-sm p-6 flex flex-col gap-5">
            <div>
              <label className="block text-sm font-medium text-gray-600 mb-1">🔐 코드</label>
              <input
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-300"
                placeholder="학생이 입력할 코드 (예: 바나나)"
                value={code}
                onChange={(e) => setCode(e.target.value)}
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-600 mb-1">📝 제목</label>
              <input
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-300"
                placeholder="미션 제목 (예: 바닷속 친구 그리기)"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-600 mb-1">🖼️ 목표 그림</label>
              <input
                ref={fileRef}
                type="file"
                accept="image/png,image/jpeg,image/webp"
                className="hidden"
                onChange={(e) => pickImage(e.target.files?.[0])}
              />
              {targetImage ? (
                <div className="flex items-center gap-3">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={targetImage} alt="목표 그림" className="h-24 w-24 object-cover rounded-lg border border-sky-200" />
                  <button
                    onClick={() => fileRef.current?.click()}
                    className="text-sm text-sky-600 hover:underline"
                  >
                    다른 그림으로 바꾸기
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => fileRef.current?.click()}
                  className="w-full border-2 border-dashed border-gray-200 hover:border-sky-300 hover:bg-sky-50 text-gray-400 rounded-xl py-8 text-sm transition-colors"
                >
                  📎 목표 그림 올리기
                </button>
              )}
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-600 mb-1">🔁 시도 횟수</label>
              <input
                type="number"
                min={1}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-300"
                value={attemptLimit}
                onChange={(e) => setAttemptLimit(e.target.value)}
              />
              <p className="text-[11px] text-gray-400 mt-1">승인된 그림만 1회로 세요. 다 쓰면 마지막 그림이 자동 제출돼요.</p>
            </div>

            <label className="flex items-center gap-2 text-sm text-gray-600 cursor-pointer">
              <input
                type="checkbox"
                checked={allowUpload}
                onChange={(e) => setAllowUpload(e.target.checked)}
                className="w-4 h-4 accent-sky-500"
              />
              📎 학생이 자기 그림을 첨부해서 변형하는 것 허용
            </label>

            {error && <p className="text-sm text-rose-500">{error}</p>}

            <button
              onClick={handleCreate}
              disabled={!canSubmit}
              className="bg-sky-500 hover:bg-sky-600 disabled:bg-gray-200 disabled:cursor-not-allowed text-white font-bold py-3 rounded-xl text-sm transition-colors"
            >
              {status === "creating" ? "만드는 중..." : "챌린지 만들기"}
            </button>
          </div>
        )}
      </main>
    </div>
  )
}
