"use client"

import { useState, useEffect, useRef } from "react"
import { db } from "@/lib/firebase"
import { collection, query, where, onSnapshot } from "firebase/firestore"
import { ImageRequest } from "@/types"

type Message = { role: "user" | "assistant"; content: string; type?: "text" | "image" }

// 업로드 이미지를 최대 1024px PNG 데이터 URL로 축소 (전송량·생성 크기 정렬)
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

export default function StudentPage() {
  const [code, setCode] = useState("")
  const [studentName, setStudentName] = useState("")
  const [messages, setMessages] = useState<Message[]>([
    { role: "assistant", content: "안녕하세요! 그리고 싶은 그림을 설명하거나, 내가 그린 그림을 올려서 바꿔볼 수도 있어요!", type: "text" },
  ])
  const [input, setInput] = useState("")
  const [attachedImage, setAttachedImage] = useState<string | null>(null) // data URL
  const [promptHistory, setPromptHistory] = useState<string[]>([])
  const [status, setStatus] = useState<"idle" | "generating" | "waiting">("idle")
  const [pendingId, setPendingId] = useState<string | null>(null)
  const bottomRef = useRef<HTMLDivElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [messages])

  useEffect(() => {
    if (!pendingId || status !== "waiting") return

    const q = query(collection(db, "requests"), where("__name__", "==", pendingId))
    const unsub = onSnapshot(q, (snap) => {
      if (snap.empty) return
      const data = snap.docs[0].data() as ImageRequest
      if (data.status === "approved") {
        setMessages((prev) => [...prev, { role: "assistant", content: data.imageUrl, type: "image" }])
        setStatus("idle")
        setPendingId(null)
      } else if (data.status === "rejected") {
        setMessages((prev) => [
          ...prev,
          { role: "assistant", content: "이 그림은 선생님이 통과시키지 않았어요. 설명을 바꿔서 다시 그려볼까요?", type: "text" },
        ])
        setStatus("idle")
        setPendingId(null)
      }
    })
    return () => unsub()
  }, [pendingId, status])

  const pickImage = async (file: File | null | undefined) => {
    if (!file) return
    try {
      setAttachedImage(await fileToDownscaledPng(file))
    } catch {
      /* 이미지 읽기 실패는 무시 */
    }
  }

  const handleSubmit = async () => {
    if ((!input.trim() && !attachedImage) || !code || !studentName || status !== "idle") return

    const hasImage = !!attachedImage
    const desc = input.trim() || (hasImage ? "이 그림을 어린이용 부드러운 그림책 스타일로 바꿔줘." : "")
    const imageDataUrl = attachedImage

    setInput("")
    setAttachedImage(null)
    if (imageDataUrl) {
      setMessages((prev) => [...prev, { role: "user", content: imageDataUrl, type: "image" }])
    }
    setMessages((prev) => [...prev, { role: "user", content: desc, type: "text" }])
    setStatus("generating")

    const newHistory = [...promptHistory, desc]
    setPromptHistory(newHistory)

    try {
      const body: Record<string, unknown> = {
        code,
        studentName,
        description: desc,
        promptHistory: newHistory,
      }
      if (imageDataUrl) {
        body.imageBase64 = imageDataUrl.split(",")[1]
        body.imageMimeType = "image/png"
      }

      const res = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)

      setPendingId(data.id)
      setStatus("waiting")
      setMessages((prev) => [...prev, { role: "assistant", content: "선생님이 그림을 확인 중이에요. 잠시만 기다려 주세요!", type: "text" }])
    } catch {
      setStatus("idle")
      setMessages((prev) => [...prev, { role: "assistant", content: "오류가 발생했어요. 다시 시도해 주세요.", type: "text" }])
    }
  }

  const canSubmit = !!code.trim() && !!studentName.trim() && (!!input.trim() || !!attachedImage) && status === "idle"

  return (
    <div className="flex h-screen bg-amber-50">
      {/* 사이드바 */}
      <aside className="w-64 bg-white border-r border-amber-200 p-6 flex flex-col gap-4 shrink-0">
        <div>
          <h1 className="text-xl font-bold text-amber-700 mb-1">🎨 AI 그림 그리기</h1>
          <p className="text-xs text-gray-400">선생님이 확인 후 그림을 보여드려요</p>
        </div>
        <div className="flex flex-col gap-3">
          <div>
            <label className="block text-sm font-medium text-gray-600 mb-1">🔑 코드</label>
            <input
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-300"
              placeholder="선생님께 받은 코드"
              value={code}
              onChange={(e) => setCode(e.target.value)}
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-600 mb-1">🧒 이름</label>
            <input
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-300"
              placeholder="내 이름"
              value={studentName}
              onChange={(e) => setStudentName(e.target.value)}
            />
          </div>
        </div>
        {status === "generating" && (
          <div className="text-xs text-amber-600 animate-pulse">🖌️ 그림 생성 중...</div>
        )}
        {status === "waiting" && (
          <div className="text-xs text-blue-600 animate-pulse">⏳ 선생님 확인 대기 중...</div>
        )}
        <p className="text-[11px] text-gray-400 mt-auto leading-relaxed">
          💡 📎 버튼으로 내가 그린 그림을 올려서 바꿔볼 수 있어요. 친구 사진 같은 건 올리지 마세요!
        </p>
      </aside>

      {/* 메인 채팅 영역 */}
      <main className="flex-1 flex flex-col">
        <div className="flex-1 overflow-y-auto p-6 space-y-4">
          {messages.map((msg, i) => (
            <div key={i} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
              {msg.type === "image" ? (
                <div className="max-w-sm rounded-2xl overflow-hidden shadow-md border border-amber-100">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={msg.content} alt="그림" className="w-full" />
                </div>
              ) : (
                <div
                  className={`max-w-xs lg:max-w-md px-4 py-3 rounded-2xl text-sm leading-relaxed ${
                    msg.role === "user"
                      ? "bg-amber-400 text-white rounded-br-sm"
                      : "bg-white text-gray-700 border border-amber-100 rounded-bl-sm shadow-sm"
                  }`}
                >
                  {msg.content}
                </div>
              )}
            </div>
          ))}
          <div ref={bottomRef} />
        </div>

        {/* 입력창 */}
        <div className="p-4 bg-white border-t border-amber-100">
          {!code || !studentName ? (
            <p className="text-center text-sm text-gray-400 py-2">왼쪽에서 코드와 이름을 먼저 입력해 주세요.</p>
          ) : (
            <>
              {attachedImage && (
                <div className="mb-2 flex items-center gap-2">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={attachedImage} alt="첨부한 그림" className="h-16 w-16 object-cover rounded-lg border border-amber-200" />
                  <span className="text-xs text-gray-500">이 그림을 바꿀게요</span>
                  <button
                    onClick={() => setAttachedImage(null)}
                    className="text-xs text-gray-400 hover:text-red-500"
                  >
                    ✕ 제거
                  </button>
                </div>
              )}
              <div className="flex gap-2 items-end">
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  className="hidden"
                  onChange={(e) => pickImage(e.target.files?.[0])}
                />
                <button
                  type="button"
                  onClick={() => fileRef.current?.click()}
                  disabled={status !== "idle"}
                  title="내 그림 올리기"
                  className="shrink-0 border border-gray-200 hover:bg-amber-50 disabled:opacity-40 text-gray-500 rounded-xl px-3 py-3 text-lg transition-colors"
                >
                  📎
                </button>
                <textarea
                  className="flex-1 border border-gray-200 rounded-xl px-4 py-3 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-amber-300"
                  rows={2}
                  placeholder={attachedImage ? "올린 그림을 어떻게 바꿀지 설명해보세요." : "그리고 싶은 내용을 자세히 설명해보세요. 그림체, 분위기, 인물, 색감, 동작 등"}
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault()
                      handleSubmit()
                    }
                  }}
                  disabled={status !== "idle"}
                />
                <button
                  onClick={handleSubmit}
                  disabled={!canSubmit}
                  className="bg-amber-400 hover:bg-amber-500 disabled:bg-gray-200 disabled:cursor-not-allowed text-white font-bold px-5 py-3 rounded-xl text-sm transition-colors"
                >
                  전송
                </button>
              </div>
            </>
          )}
        </div>
      </main>
    </div>
  )
}
