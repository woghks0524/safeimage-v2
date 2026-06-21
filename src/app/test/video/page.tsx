"use client"

import { useState, useRef, useEffect } from "react"

/**
 * 영상 생성 테스트 페이지 (텍스트→영상 / 이미지→영상).
 * 본 서비스(safeimage)와 분리된 실험용. 핵심 로직은 src/lib/video.ts 에 있다.
 */

type Mode = "text" | "image"
type Status = "idle" | "starting" | "polling" | "done" | "error"

const MODELS = ["sora-2", "sora-2-pro"] as const
const SECONDS = ["4", "8", "12"] as const
const SIZES = ["720x1280", "1280x720", "1024x1792", "1792x1024"] as const

// 업로드 이미지를 선택한 영상 해상도에 정확히 맞춰 cover-crop (Sora 참조 이미지 = 출력 크기 일치 요건)
async function fileToSizedPng(file: File, size: string): Promise<string> {
  const [tw, th] = size.split("x").map(Number)
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
  const scale = Math.max(tw / img.width, th / img.height)
  const w = img.width * scale
  const h = img.height * scale
  const canvas = document.createElement("canvas")
  canvas.width = tw
  canvas.height = th
  canvas.getContext("2d")!.drawImage(img, (tw - w) / 2, (th - h) / 2, w, h)
  return canvas.toDataURL("image/png")
}

export default function VideoTestPage() {
  const [mode, setMode] = useState<Mode>("text")
  const [prompt, setPrompt] = useState("")
  const [model, setModel] = useState<string>("sora-2")
  const [seconds, setSeconds] = useState<string>("4")
  const [size, setSize] = useState<string>("720x1280")
  const [image, setImage] = useState<string | null>(null) // data URL (선택 해상도에 맞춰짐)

  const [status, setStatus] = useState<Status>("idle")
  const [progress, setProgress] = useState(0)
  const [videoUrl, setVideoUrl] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  useEffect(() => () => { if (pollRef.current) clearInterval(pollRef.current) }, [])

  const busy = status === "starting" || status === "polling"

  async function onPickImage(file: File) {
    const sized = await fileToSizedPng(file, size)
    setImage(sized)
  }

  function reset() {
    if (pollRef.current) clearInterval(pollRef.current)
    setStatus("idle")
    setProgress(0)
    setVideoUrl(null)
    setError(null)
  }

  async function generate() {
    reset()
    setStatus("starting")
    try {
      const payload: Record<string, unknown> = { prompt, model, seconds, size }
      if (mode === "image" && image) {
        payload.imageBase64 = image.split(",")[1]
        payload.imageMimeType = "image/png"
      }
      const res = await fetch("/api/video", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || "시작 실패")

      setStatus("polling")
      pollRef.current = setInterval(() => poll(data.id), 4000)
    } catch (e) {
      setError(e instanceof Error ? e.message : "오류")
      setStatus("error")
    }
  }

  async function poll(id: string) {
    try {
      const res = await fetch(`/api/video?id=${id}`)
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || "상태 조회 실패")

      if (data.status === "failed") throw new Error(data.error || "생성 실패")
      if (typeof data.progress === "number") setProgress(data.progress)

      if (data.status === "completed") {
        if (pollRef.current) clearInterval(pollRef.current)
        setVideoUrl(data.videoUrl)
        setProgress(100)
        setStatus("done")
      }
    } catch (e) {
      if (pollRef.current) clearInterval(pollRef.current)
      setError(e instanceof Error ? e.message : "오류")
      setStatus("error")
    }
  }

  return (
    <main className="mx-auto max-w-2xl p-6">
      <h1 className="text-2xl font-bold">🎬 영상 생성 테스트</h1>
      <p className="mt-1 text-sm text-gray-500">
        Sora 2 · 텍스트→영상 / 이미지→영상 실험용 (safeimage 본 서비스와 분리)
      </p>

      {/* 모드 탭 */}
      <div className="mt-5 flex gap-2">
        {(["text", "image"] as Mode[]).map((m) => (
          <button
            key={m}
            onClick={() => { setMode(m); setImage(null) }}
            disabled={busy}
            className={`rounded-full px-4 py-1.5 text-sm font-medium ${
              mode === m ? "bg-black text-white" : "bg-gray-100 text-gray-700"
            }`}
          >
            {m === "text" ? "텍스트 → 영상" : "이미지 → 영상"}
          </button>
        ))}
      </div>

      {/* 이미지 업로드 */}
      {mode === "image" && (
        <div className="mt-4">
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => e.target.files?.[0] && onPickImage(e.target.files[0])}
          />
          <button
            onClick={() => fileRef.current?.click()}
            disabled={busy}
            className="rounded-lg border border-dashed border-gray-300 px-4 py-2 text-sm"
          >
            {image ? "이미지 다시 선택" : "참조 이미지 선택"}
          </button>
          {image && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={image} alt="참조" className="mt-3 max-h-48 rounded-lg border" />
          )}
        </div>
      )}

      {/* 프롬프트 */}
      <textarea
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
        disabled={busy}
        rows={3}
        placeholder={mode === "text" ? "만들고 싶은 영상을 설명하세요…" : "이미지를 어떻게 움직이게 할지 설명하세요…"}
        className="mt-4 w-full rounded-lg border border-gray-300 p-3 text-sm"
      />

      {/* 옵션 */}
      <div className="mt-3 grid grid-cols-3 gap-3 text-sm">
        <label className="flex flex-col gap-1">
          <span className="text-gray-500">모델</span>
          <select value={model} onChange={(e) => setModel(e.target.value)} disabled={busy} className="rounded border p-2">
            {MODELS.map((m) => <option key={m}>{m}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-gray-500">길이(초)</span>
          <select value={seconds} onChange={(e) => setSeconds(e.target.value)} disabled={busy} className="rounded border p-2">
            {SECONDS.map((s) => <option key={s}>{s}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-gray-500">해상도</span>
          <select value={size} onChange={(e) => setSize(e.target.value)} disabled={busy} className="rounded border p-2">
            {SIZES.map((s) => <option key={s}>{s}</option>)}
          </select>
        </label>
      </div>

      <button
        onClick={generate}
        disabled={busy || !prompt.trim() || (mode === "image" && !image)}
        className="mt-5 w-full rounded-lg bg-black py-3 font-medium text-white disabled:opacity-40"
      >
        {busy ? "생성 중…" : "영상 생성"}
      </button>

      {/* 상태 */}
      {busy && (
        <div className="mt-5">
          <div className="h-2 w-full overflow-hidden rounded-full bg-gray-100">
            <div className="h-full bg-black transition-all" style={{ width: `${progress}%` }} />
          </div>
          <p className="mt-2 text-center text-sm text-gray-500">
            {status === "starting" ? "잡 생성 중…" : `생성 중… ${progress}%`} (영상은 수십 초~수 분 걸려요)
          </p>
        </div>
      )}

      {error && (
        <p className="mt-5 rounded-lg bg-red-50 p-3 text-sm text-red-600">⚠️ {error}</p>
      )}

      {videoUrl && (
        <div className="mt-5">
          <video src={videoUrl} controls autoPlay loop className="w-full rounded-lg" />
          <a href={videoUrl} target="_blank" rel="noreferrer" className="mt-2 inline-block text-sm text-blue-600 underline">
            새 탭에서 열기 / 다운로드
          </a>
        </div>
      )}
    </main>
  )
}
