export interface ImageRequest {
  id: string
  code: string
  studentName: string
  description: string
  imagePrompt: string
  imageUrl: string
  originalImageUrl?: string
  status: "pending" | "approved" | "rejected"
  rejectMessage?: string
  challengeCode?: string
  createdAt: number
}

export interface Challenge {
  code: string                  // 문서 ID = 코드 (학생이 입력)
  title: string
  targetImageUrl: string
  attemptLimit: number
  allowUpload: boolean          // 학생의 📎 그림 첨부 허용 여부
  createdAt: number
}

export interface Participant {
  studentName: string           // 문서 ID = 학생 이름
  attemptsUsed: number          // 승인된 횟수만 누적
  submittedRequestId?: string   // 제출이 확정되면 마지막 승인본 id
  submittedAt?: number
  locked: boolean               // 제출 완료 또는 시도 소진 시 true
}
