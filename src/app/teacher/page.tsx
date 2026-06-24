"use client"

import { useState, useEffect, useRef } from "react"
import Link from "next/link"
import { db } from "@/lib/firebase"
import { collection, query, where, orderBy, onSnapshot } from "firebase/firestore"
import { ImageRequest } from "@/types"

export default function TeacherPage() {
  const [code, setCode] = useState("")
  const [inputCode, setInputCode] = useState("")
  const [requests, setRequests] = useState<ImageRequest[]>([])
  const [rejectingId, setRejectingId] = useState<string | null>(null)
  const [rejectMessage, setRejectMessage] = useState("")
  const [autoApprove, setAutoApprove] = useState(false)
  const autoApprovedRef = useRef<Set<string>>(new Set()) // 자동 승인 중복 호출 방지

  // 자동 승인이 켜져 있으면 들어오는 미승인 요청을 즉시 승인한다
  useEffect(() => {
    if (!autoApprove) return
    requests.forEach((req) => {
      if (autoApprovedRef.current.has(req.id)) return
      autoApprovedRef.current.add(req.id)
      fetch("/api/approve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: req.id }),
      }).catch(() => autoApprovedRef.current.delete(req.id))
    })
  }, [autoApprove, requests])

  useEffect(() => {
    if (!code) return

    const q = query(
      collection(db, "requests"),
      where("code", "==", code),
      where("status", "==", "pending"),
      orderBy("createdAt", "asc")
    )

    const unsub = onSnapshot(q, (snap) => {
      setRequests(snap.docs.map((d) => ({ id: d.id, ...d.data() } as ImageRequest)))
    })
    return () => unsub()
  }, [code])

  const handleApprove = async (id: string) => {
    await fetch("/api/approve", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    })
  }

  const startReject = (id: string) => {
    setRejectingId(id)
    setRejectMessage("")
  }

  const submitReject = async (id: string) => {
    await fetch("/api/reject", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, message: rejectMessage }),
    })
    setRejectingId(null)
    setRejectMessage("")
  }

  return (
    <div className="min-h-screen bg-sky-50">
      <header className="bg-white border-b border-sky-100 px-8 py-4 flex items-center gap-6">
        <div>
          <h1 className="text-xl font-bold text-sky-700">🧑‍🏫 AI 그림 승인 페이지</h1>
          <p className="text-xs text-gray-400">학생이 요청한 그림을 확인하고 승인해 주세요</p>
        </div>
        <div className="flex gap-2 ml-auto items-center">
          <label className="flex items-center gap-2 text-sm mr-2 cursor-pointer select-none whitespace-nowrap">
            <span className={autoApprove ? "text-emerald-600 font-semibold" : "text-gray-500"}>
              ⚡ 자동 승인
            </span>
            <button
              type="button"
              role="switch"
              aria-checked={autoApprove}
              onClick={() => setAutoApprove((v) => !v)}
              className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                autoApprove ? "bg-emerald-500" : "bg-gray-300"
              }`}
            >
              <span
                className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
                  autoApprove ? "translate-x-6" : "translate-x-1"
                }`}
              />
            </button>
          </label>
          <Link
            href="/teacher/challenge"
            className="text-sm text-sky-600 hover:underline mr-2 whitespace-nowrap"
          >
            🎯 챌린지 만들기
          </Link>
          <Link
            href="/teacher/results"
            className="text-sm text-sky-600 hover:underline mr-2 whitespace-nowrap"
          >
            🖼️ 제출본
          </Link>
          <input
            className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-300"
            placeholder="🔐 코드 입력 (예: 바나나)"
            value={inputCode}
            onChange={(e) => setInputCode(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && setCode(inputCode.trim())}
          />
          <button
            onClick={() => setCode(inputCode.trim())}
            className="bg-sky-500 hover:bg-sky-600 text-white text-sm font-semibold px-4 py-2 rounded-lg transition-colors"
          >
            조회
          </button>
        </div>
      </header>

      <main className="p-8">
        {autoApprove && (
          <div className="mb-4 rounded-lg bg-emerald-50 border border-emerald-200 px-4 py-2 text-sm text-emerald-700">
            ⚡ 자동 승인이 켜져 있어요. 들어오는 그림이 검토 없이 바로 승인됩니다.
          </div>
        )}
        {!code ? (
          <div className="flex flex-col items-center justify-center h-64 text-gray-400">
            <p className="text-lg">위에서 코드를 입력하면 미승인 그림 목록이 나타납니다.</p>
          </div>
        ) : requests.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-64 text-gray-400">
            <p className="text-lg">✅ 현재 승인 대기 중인 그림이 없습니다.</p>
          </div>
        ) : (
          <>
            <p className="text-sm text-gray-500 mb-4">
              <span className="font-semibold text-sky-600">&apos;{code}&apos;</span> 코드 — 승인 대기 {requests.length}개
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
              {requests.map((req) => (
                <div key={req.id} className="bg-white rounded-2xl border border-sky-100 shadow-sm overflow-hidden flex flex-col">
                  <div className="relative">
                    {req.mediaType === "video" ? (
                      <>
                        <video src={req.videoUrl} controls className="w-full aspect-square object-cover bg-black" />
                        <span className="absolute top-2 left-2 bg-indigo-600/90 text-white text-[11px] font-semibold px-2 py-0.5 rounded-full">
                          🎬 영상
                        </span>
                      </>
                    ) : (
                      <>
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={req.imageUrl} alt="생성된 그림" className="w-full aspect-square object-cover" />
                        {req.originalImageUrl && (
                          <span className="absolute top-2 left-2 bg-amber-500/90 text-white text-[11px] font-semibold px-2 py-0.5 rounded-full">
                            🖼️ 업로드 변형
                          </span>
                        )}
                      </>
                    )}
                  </div>
                  <div className="p-4 flex flex-col gap-2 flex-1">
                    <p className="font-semibold text-gray-700 text-sm">🙋 {req.studentName}</p>
                    <p className="text-xs text-gray-500 leading-relaxed line-clamp-3">{req.description}</p>
                    {req.originalImageUrl && (
                      <div className="flex items-center gap-2 text-[11px] text-gray-400">
                        <span>원본</span>
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={req.originalImageUrl} alt="학생 원본" className="h-10 w-10 object-cover rounded border border-gray-200" />
                      </div>
                    )}
                    {rejectingId === req.id ? (
                      <div className="flex flex-col gap-2 mt-auto pt-2">
                        <textarea
                          autoFocus
                          value={rejectMessage}
                          onChange={(e) => setRejectMessage(e.target.value)}
                          placeholder="학생에게 보낼 메시지 (예: 무서운 느낌은 빼고 다시 그려볼까요?)"
                          rows={2}
                          className="border border-gray-200 rounded-lg px-2 py-1.5 text-xs resize-none focus:outline-none focus:ring-2 focus:ring-rose-200"
                        />
                        <div className="flex gap-2">
                          <button
                            onClick={() => submitReject(req.id)}
                            className="flex-1 bg-rose-500 hover:bg-rose-600 text-white text-xs font-semibold py-2 rounded-lg transition-colors"
                          >
                            거부 보내기
                          </button>
                          <button
                            onClick={() => { setRejectingId(null); setRejectMessage("") }}
                            className="flex-1 bg-gray-100 hover:bg-gray-200 text-gray-500 text-xs font-semibold py-2 rounded-lg transition-colors"
                          >
                            취소
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="flex gap-2 mt-auto pt-2">
                        <button
                          onClick={() => handleApprove(req.id)}
                          className="flex-1 bg-emerald-500 hover:bg-emerald-600 text-white text-sm font-semibold py-2 rounded-lg transition-colors"
                        >
                          ✅ 승인
                        </button>
                        <button
                          onClick={() => startReject(req.id)}
                          className="flex-1 bg-rose-400 hover:bg-rose-500 text-white text-sm font-semibold py-2 rounded-lg transition-colors"
                        >
                          ❌ 거부
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </main>
    </div>
  )
}
