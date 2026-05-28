export interface ImageRequest {
  id: string
  code: string
  studentName: string
  description: string
  imagePrompt: string
  imageUrl: string
  originalImageUrl?: string
  status: "pending" | "approved" | "rejected"
  createdAt: number
}
