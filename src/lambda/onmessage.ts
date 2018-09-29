import compose from 'koa-compose'
import { Lambda } from '../types'
import { onMessage as onIotMessage, createSuccessHandler, createErrorHandler } from '../middleware/oniotmessage'
import { onMessage } from '../middleware/onmessage'
import { createMiddleware as onMessagesSaved } from '../middleware/onmessagessaved'
import { logifyFunction } from '../utils'

export const createMiddleware = (lambda:Lambda, opts?:any) => {
  const { logger } = lambda
  return compose([
    onIotMessage(lambda, opts),
    logifyFunction({
      fn: onMessage(lambda, {
        onSuccess: createSuccessHandler(lambda, opts),
        onError: createErrorHandler(lambda, opts)
      }),
      name: 'preprocess message',
      level: 'silly',
      logger
    }),
    logifyFunction({
      fn: onMessagesSaved(lambda.bot, opts),
      name: 'business logic',
      level: 'silly',
      logger
    })
  ])
}
