export type Message = {
    role: "user" | "assistant"
    content: string
}

export type Conversation = {
    id: string
    title: string
    createdAt: number
    messages: Message[]
}

export type RequestLog = {
    id: string
    timestamp: number
    model: string
    promptTokens: number
    completionTokens: number
    tokensPerSecond: number
    timeToFirstToken: number
    totalTime: number
    promptPreview: string
}

export type RagDocument = {
    id: string
    name: string
    size: number
    chunkCount: number
    uploadedAt: number
}

export type GpuStats = {
    utilizationPercent: number
    memoryUsedMB: number
    memoryTotalMB: number
    temperatureC: number
} | null

export type SystemStats = {
    ram: {
        totalBytes: number
        usedBytes: number
        freeBytes: number
        percent: number
    }
    gpu: GpuStats
    ollama: {
        models: Array<{
            name: string
            size: number
            size_vram: number
        }>
    } | null
}

export type MetricsResponse = {
    requests: number
    avgResponseTime: number
    avgTimeToFirstToken: number
    avgTokensPerSecond: number
    totalPromptTokens: number
    totalCompletionTokens: number
    logs: RequestLog[]
}
