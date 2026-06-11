"use client"

import { useState, useEffect } from "react"
import Link from "next/link"
import { db } from "@/lib/firebase"
import { collection, doc, onSnapshot } from "firebase/firestore"
import { Challenge, Participant } from "@/types"

export default function ChallengeResultsPage() {
  const [code, setCode] = useState("")
  const [inputCode, setInputCode] = useState("")
  const [challenge, setChallenge] = useState<Challenge | null>(null)
  const [notFound, setNotFound] = useState(false)
  const [participants, setParticipants] = useState<Participant[]>([])

  useEffect(() => {
    if (!code) return
    const unsub = onSnapshot(doc(db, "challenges", code), (snap) => {
      setChallenge(snap.exists() ? (snap.data() as Challenge) : null)
      setNotFound(!snap.exists())
    })
    return () => unsub()
  }, [code])

  useEffect(() => {
    if (!code) return
    const unsub = onSnapshot(collection(db, "challenges", code, "participants"), (snap) => {
      const list = snap.docs.map((d) => d.data() as Participant)
      // 제출본이 있는 학생을 먼저, 그 안에서는 제출 시각 순으로
      list.sort((a, b) => (b.submittedAt ?? 0) - (a.submittedAt ?? 0))
      setParticipants(list)
    })
    return () => unsub()
  }, [code])

  const submitted = participants.filter((p) => p.submittedImageUrl)
  const lockedCount = participants.filter((p) => p.locked).length

  return (
    <div className="min-h-screen bg-sky-50">
      <header className="bg-white border-b border-sky-100 px-8 py-4 flex items-center gap-6">
        <div>
          <h1 className="text-xl font-bold text-sky-700">🖼️ 챌린지 제출본</h1>
          <p className="text-xs text-gray-400">학생들이 제출한 그림을 목표와 비교해 보세요</p>
        </div>
        <div className="flex gap-2 ml-auto items-center">
          <Link href="/teacher" className="text-sm text-sky-600 hover:underline mr-2 whitespace-nowrap">
            ← 승인 페이지
          </Link>
          <input
            className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-300"
            placeholder="🔐 챌린지 코드"
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
        {!code ? (
          <div className="flex flex-col items-center justify-center h-64 text-gray-400">
            <p className="text-lg">챌린지 코드를 입력하면 제출본이 나타납니다.</p>
          </div>
        ) : notFound ? (
          <div className="flex flex-col items-center justify-center h-64 text-gray-400">
            <p className="text-lg">해당 코드의 챌린지를 찾을 수 없어요.</p>
          </div>
        ) : (
          <div className="flex flex-col gap-6">
            {/* 챌린지 요약 + 목표 그림 */}
            <div className="bg-white rounded-2xl border border-sky-100 shadow-sm p-5 flex items-center gap-5">
              {challenge?.targetImageUrl && (
                /* eslint-disable-next-line @next/next/no-img-element */
                <img
                  src={challenge.targetImageUrl}
                  alt="목표 그림"
                  className="h-28 w-28 object-cover rounded-xl border border-sky-200 shrink-0"
                />
              )}
              <div>
                <p className="text-xs text-gray-400">목표 그림</p>
                <h2 className="text-lg font-bold text-gray-700">{challenge?.title}</h2>
                <p className="text-sm text-gray-500 mt-1">
                  참가 {participants.length}명 · 제출 완료 {lockedCount}명 · 시도 한도 {challenge?.attemptLimit}회
                </p>
              </div>
            </div>

            {submitted.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-48 text-gray-400">
                <p className="text-lg">아직 제출된 그림이 없어요.</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                {submitted.map((p) => (
                  <div
                    key={p.studentName}
                    className="bg-white rounded-2xl border border-sky-100 shadow-sm overflow-hidden flex flex-col"
                  >
                    <div className="relative">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={p.submittedImageUrl} alt="제출 그림" className="w-full aspect-square object-cover" />
                      <span
                        className={`absolute top-2 right-2 text-[11px] font-semibold px-2 py-0.5 rounded-full text-white ${
                          p.locked ? "bg-emerald-500/90" : "bg-amber-500/90"
                        }`}
                      >
                        {p.locked ? "✅ 제출 완료" : "✏️ 진행 중"}
                      </span>
                    </div>
                    <div className="p-4 flex flex-col gap-1 flex-1">
                      <p className="font-semibold text-gray-700 text-sm">🙋 {p.studentName}</p>
                      {p.submittedDescription && (
                        <p className="text-xs text-gray-500 leading-relaxed line-clamp-3">{p.submittedDescription}</p>
                      )}
                      <p className="text-[11px] text-gray-400 mt-auto pt-1">시도 {p.attemptsUsed}회</p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </main>
    </div>
  )
}
