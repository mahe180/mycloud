import { Lambda } from '../types'
import { fromSchedule } from '../lambda'

const SAFETY_MARGIN_MILLIS = 20000

export const createLambda = (opts) => {
  const lambda = fromSchedule(opts)
  return lambda.use(createMiddleware(lambda, opts))
}

export const createMiddleware = (lambda:Lambda, opts?:any) => {
  const { seals, env, logger } = lambda.bot
  return async (ctx, next) => {
    let results = []
    let batch:any[]
    let haveTime
    do {
      batch = await seals.syncUnconfirmed({ limit: 10 })
      debugger
      results = results.concat(batch)
      haveTime = env.getRemainingTime() > SAFETY_MARGIN_MILLIS
    } while (haveTime && batch.length)

    if (!haveTime) {
      logger.debug('almost out of time, exiting early')
    }

    ctx.seals = results
    await next()
  }
}
