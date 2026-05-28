import Link from "next/link"

export default function Home() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-amber-50 to-sky-50 flex flex-col items-center justify-center gap-8">
      <div className="text-center">
        <h1 className="text-4xl font-bold text-gray-700 mb-2">🎨 SafeImage</h1>
        <p className="text-gray-400">선생님과 함께하는 AI 그림 그리기</p>
      </div>
      <div className="flex gap-4">
        <Link
          href="/student"
          className="bg-amber-400 hover:bg-amber-500 text-white font-bold px-8 py-4 rounded-2xl text-lg transition-colors shadow-md"
        >
          학생용
        </Link>
        <Link
          href="/teacher"
          className="bg-sky-500 hover:bg-sky-600 text-white font-bold px-8 py-4 rounded-2xl text-lg transition-colors shadow-md"
        >
          교사용
        </Link>
      </div>
    </div>
  )
}
