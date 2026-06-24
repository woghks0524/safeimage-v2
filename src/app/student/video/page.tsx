"use client"

import { useState, useEffect, useRef } from "react"
import Link from "next/link"
import { db } from "@/lib/firebase"
import { doc, onSnapshot } from "firebase/firestore"
import { ImageRequest } from "@/types"

/**
 * 학생용 영상 생성 페이지.
 * 이미지와 동일한 교사 승인 흐름: 생성 → requests(pending) → 교사 승인 → 학생에게 공개.
 * 비용 통제를 위해 모델(sora-2)·길이(4초)는 고정하고 화면 방향만 선택.
 */

type Mode = "text" | "image"
type Status = "idle" | "generating" | "waiting" | "approved" | "rejected" | "error"
type Orientation = "portrait" | "landscape"

const SIZE_BY_ORIENTATION: Record<Orientation, string> = {
  portrait: "720x1280",
  landscape: "1280x720",
}

// 업로드 이미지를 영상 해상도에 맞춰 cover-crop (Sora 참조 이미지 = 출력 크기 일치)
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

export default function StudentVideoPage() {
  const [code, setCode] = useState("")
  const [studentName, setStudentName] = useState("")
  const [mode, setMode] = useState<Mode>("text")
  const [prompt, setPrompt] = useState("")
  const [orientation, setOrientation] = useState<Orientation>("portrait")
  const [image, setImage] = useState<string | null>(null)

  const [status, setStatus] = useState<Status>("idle")
  const [progress, setProgress] = useState(0)
  const [videoUrl, setVideoUrl] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [requestId, setRequestId] = useState<string | null>(null)

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  useEffect(() => () => { if (pollRef.current) clearInterval(pollRef.current) }, [])

  // 생성이 끝나 승인 대기(waiting) 상태가 되면 요청 문서를 구독해 교사 승인/거부를 반영
  useEffect(() => {
    if (status !== "waiting" || !requestId) return
    const unsub = onSnapshot(doc(db, "requests", requestId), (snap) => {
      const data = snap.data() as ImageRequest | undefined
      if (!data) return
      if (data.status === "approved") {
        setVideoUrl(data.videoUrl ?? null)
        setStatus("approved")
      } else if (data.status === "rejected") {
        setMessage(data.rejectMessage?.trim() || "이 영상은 선생님이 통과시키지 않았어요. 다시 만들어볼까요?")
        setStatus("rejected")
      }
    })
    return () => unsub()
  }, [status, requestId])

  const busy = status === "generating" || status === "waiting"
  const size = SIZE_BY_ORIENTATION[orientation]

  async function onPickImage(file: File) {
    setImage(await fileToSizedPng(file, size))
  }

  function changeOrientation(o: Orientation) {
    setOrientation(o)
    setImage(null)
  }

  async function generate() {
    if (!code.trim() || !studentName.trim() || !prompt.trim() || busy) return
    if (pollRef.current) clearInterval(pollRef.current)
    setStatus("generating")
    setProgress(0)
    setVideoUrl(null)
    setMessage(null)
    setRequestId(null)

    try {
      const payload: Record<string, unknown> = {
        code: code.trim(),
        studentName: studentName.trim(),
        description: prompt.trim(),
        prompt: prompt.trim(),
        model: "sora-2",
        seconds: "4",
        size,
      }
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

      setRequestId(data.requestId ?? null)
      pollRef.current = setInterval(() => poll(data.id, data.requestId), 4000)
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "오류가 발생했어요.")
      setStatus("error")
    }
  }

  async function poll(id: string, reqId?: string) {
    try {
      const url = `/api/video?id=${id}${reqId ? `&requestId=${reqId}` : ""}`
      const res = await fetch(url)
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || "상태 조회 실패")

      if (data.status === "failed") throw new Error(data.error || "영상 생성에 실패했어요.")
      if (typeof data.progress === "number") setProgress(data.progress)

      if (data.status === "completed") {
        if (pollRef.current) clearInterval(pollRef.current)
        setProgress(100)
        // 영상은 완성됐지만 학생에겐 교사 승인 후에 공개 → 승인 대기로 전환
        setStatus("waiting")
      }
    } catch (e) {
      if (pollRef.current) clearInterval(pollRef.current)
      setMessage(e instanceof Error ? e.message : "오류가 발생했어요.")
      setStatus("error")
    }
  }

  function reset() {
    setStatus("idle")
    setProgress(0)
    setVideoUrl(null)
    setMessage(null)
    setRequestId(null)
  }

  return (
    <div className="min-h-screen bg-indigo-50">
      <header className="bg-white border-b border-indigo-100 px-8 py-4 flex items-center gap-4">
        <div>
          <h1 className="text-xl font-bold text-indigo-700">🎬 AI 영상 만들기</h1>
          <p className="text-xs text-gray-400">선생님이 확인 후 영상을 보여드려요</p>
        </div>
        <Link href="/student" className="ml-auto text-sm text-indigo-600 hover:underline">
          🎨 그림 만들기로
        </Link>
      </header>

      <main className="mx-auto max-w-xl p-6">
        {/* 코드 / 이름 */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-sm font-medium text-gray-600 mb-1">🔑 코드</label>
            <input
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300"
              placeholder="선생님께 받은 코드"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              disabled={busy}
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-600 mb-1">🧒 이름</label>
            <input
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300"
              placeholder="내 이름"
              value={studentName}
              onChange={(e) => setStudentName(e.target.value)}
              disabled={busy}
            />
          </div>
        </div>

        {/* 모드 */}
        <div className="mt-5 flex gap-2">
          {(["text", "image"] as Mode[]).map((m) => (
            <button
              key={m}
              onClick={() => { setMode(m); setImage(null) }}
              disabled={busy}
              className={`rounded-full px-4 py-1.5 text-sm font-medium ${
                mode === m ? "bg-indigo-600 text-white" : "bg-gray-100 text-gray-700"
              }`}
            >
              {m === "text" ? "글로 영상 만들기" : "그림으로 영상 만들기"}
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
              {image ? "그림 다시 선택" : "내 그림 올리기"}
            </button>
            {image && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={image} alt="올린 그림" className="mt-3 max-h-44 rounded-lg border" />
            )}
          </div>
        )}

        {/* 프롬프트 */}
        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          disabled={busy}
          rows={3}
          placeholder={mode === "text" ? "어떤 영상을 만들고 싶은지 적어보세요" : "그림을 어떻게 움직이게 할지 적어보세요"}
          className="mt-4 w-full rounded-lg border border-gray-300 p-3 text-sm"
        />

        {/* 화면 방향 */}
        <div className="mt-4">
          <span className="text-sm text-gray-500">화면 방향</span>
          <div className="mt-1 flex gap-2">
            {([
              { o: "portrait" as Orientation, label: "📱 세로형" },
              { o: "landscape" as Orientation, label: "🖥️ 가로형" },
            ]).map(({ o, label }) => (
              <button
                key={o}
                onClick={() => changeOrientation(o)}
                disabled={busy}
                className={`flex-1 rounded-lg border py-2 text-sm font-medium ${
                  orientation === o ? "border-indigo-600 bg-indigo-600 text-white" : "border-gray-300 text-gray-700"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        <button
          onClick={generate}
          disabled={busy || !code.trim() || !studentName.trim() || !prompt.trim() || (mode === "image" && !image)}
          className="mt-5 w-full rounded-lg bg-indigo-600 py-3 font-medium text-white disabled:opacity-40"
        >
          {busy ? "만드는 중…" : "영상 만들기"}
        </button>

        {/* 진행 상태 */}
        {status === "generating" && (
          <div className="mt-5">
            <div className="h-2 w-full overflow-hidden rounded-full bg-gray-100">
              <div className="h-full bg-indigo-600 transition-all" style={{ width: `${progress}%` }} />
            </div>
            <p className="mt-2 text-center text-sm text-gray-500">영상을 만들고 있어요… {progress}% (조금 걸려요)</p>
          </div>
        )}

        {status === "waiting" && (
          <p className="mt-5 rounded-lg bg-amber-50 p-3 text-center text-sm text-amber-700">
            🎬 영상이 완성됐어요! 선생님이 확인하고 있어요. 잠시만 기다려 주세요.
          </p>
        )}

        {status === "rejected" && (
          <div className="mt-5 rounded-lg bg-rose-50 p-3 text-sm text-rose-600">
            🙅 {message}
            <button onClick={reset} className="ml-2 underline">다시 만들기</button>
          </div>
        )}

        {status === "error" && (
          <p className="mt-5 rounded-lg bg-red-50 p-3 text-sm text-red-600">⚠️ {message}</p>
        )}

        {status === "approved" && videoUrl && (
          <div className="mt-5">
            <p className="mb-2 text-sm font-semibold text-emerald-600">✅ 선생님이 승인했어요!</p>
            <video src={videoUrl} controls autoPlay loop className="w-full rounded-lg" />
            <div className="mt-2 flex gap-3">
              <a href={videoUrl} target="_blank" rel="noreferrer" className="text-sm text-indigo-600 underline">
                새 탭에서 열기
              </a>
              <button onClick={reset} className="text-sm text-gray-500 underline">새 영상 만들기</button>
            </div>
          </div>
        )}
      </main>
    </div>
  )
}
