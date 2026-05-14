import pino from "pino"

const isProd = process.env.NODE_ENV === "production"

export const logger = pino({
    level: process.env.LOG_LEVEL ?? "info",
    transport: isProd ? undefined : {
        target: "pino-pretty",
        options: {
            colorize: true,
            translateTime: "HH:MM:ss",
            ignore: "pid,hostname",
        },
    },
})

export const log = {
    chat:          logger.child({ module: "chat" }),
    rag:           logger.child({ module: "rag" }),
    conversations: logger.child({ module: "conversations" }),
    agent:         logger.child({ module: "agent" }),
    system:        logger.child({ module: "system" }),
    server:        logger.child({ module: "server" }),
}
