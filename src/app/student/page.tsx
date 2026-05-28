"use client"

import { useState, useEffect, useRef } from "react"
import { db } from "@/lib/firebase"
import { collection, query, where, orderBy, onSnapshot } from "firebase/firestore"
import { ImageRequest } from "@/types"

type Message = { role: "user" | "assistant"; content: string; type?: "text" | "image" }

export default function StudentPage() {
  const [code, setCode] = useState("")
  const [studentName, setStudentName] = useState("")
  const [messages, setMessages] = useState<Message[]>([
    { role: "assistant", content: "안녕하세요! 그리고 싶은 그림에 대해 자세히 설명해주세요. 설명을 수정하면서 그림을 바꿔 나갈 수 있어요.", type: "text" },
  ])
  const [input, setInput] = useState("")
  const [promptHistory, setPromptHistory] = useState<string[]>([])
  const [status, setStatus] = useState<"idle" | "generating" | "waiting">("idle")
  const [pendingId, setPendingId] = useState<string | null>(null)
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [messages])

  useEffect(() => {
    if (!pendingId || status !== "waiting") return

    const q = query(collection(db, "requests"), where("__name__", "==", pendingId))
    const unsub = onSnapshot(q, (snap) => {
      if (snap.empty) return
      const data = snap.docs[0].data() as ImageRequest
      if (data.approved) {
        setMessages((prev) => [...prev, { role: "assistant", content: data.imageUrl, type: "image" }])
        setStatus("idle")
        setPendingId(null)
      }
    })
    return () => unsub()
  }, [pendingId, status])

  const handleSubmit = async () => {
    if (!input.trim() || !code || !studentName || status !== "idle") return

    const desc = input.trim()
    setInput("")
    setMessages((prev) => [...prev, { role: "user", content: desc, type: "text" }])
    setStatus("generating")

    const newHistory = [...promptHistory, desc]
    setPromptHistory(newHistory)

    try {
      const res = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code, studentName, description: desc, promptHistory: newHistory }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)

      setPendingId(data.id)
      setStatus("waiting")
      setMessages((prev) => [...prev, { role: "assistant", content: "선생님이 그림을 확인 중이에요. 잠시만 기다려 주세요!", type: "text" }])
    } catch (e) {
      setStatus("idle")
      setMessages((prev) => [...prev, { role: "assistant", content: "오류가 발생했어요. 다시 시도해 주세요.", type: "text" }])
    }
  }

  const canSubmit = code.trim() && studentName.trim() && input.trim() && status === "idle"

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
      </aside>

      {/* 메인 채팅 영역 */}
      <main className="flex-1 flex flex-col">
        <div className="flex-1 overflow-y-auto p-6 space-y-4">
          {messages.map((msg, i) => (
            <div key={i} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
              {msg.type === "image" ? (
                <div className="max-w-sm rounded-2xl overflow-hidden shadow-md border border-amber-100">
                  <img src={msg.content} alt="생성된 그림" className="w-full" />
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
            <div className="flex gap-2 items-end">
              <textarea
                className="flex-1 border border-gray-200 rounded-xl px-4 py-3 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-amber-300"
                rows={2}
                placeholder="그리고 싶은 내용을 자세히 설명해보세요. 그림체, 분위기, 인물, 색감, 동작 등"
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
          )}
        </div>
      </main>
    </div>
  )
}
