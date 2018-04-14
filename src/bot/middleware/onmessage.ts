// @ts-ignore
import Promise from 'bluebird'
import _ from 'lodash'
import IotMessage from '@tradle/iot-message'
import { Lambda, Bot } from '../../types'
import { fromDynamoDB } from '../lambda'
import Errors from '../../errors'

const notNull = val => !!val

export const onMessage = (lambda: Lambda, { onSuccess, onError }) => {
  const { logger, tasks, messages, user } = lambda.tradle
  return async (ctx, next) => {
    const { clientId, event } = ctx
    logger.debug(`preprocessing ${event.messages.length} messages`)
    const results = await Promise.mapSeries(event.messages, async (message, i) => {
      try {
        message = messages.normalizeInbound(message)
        message = await user.onSentMessage({ message, clientId })
      } catch (error) {
        return { message, error }
      }

      return { message }
    })

    const [failures, successes] = _.partition(results, 'error')
    const handleErrors = Promise.mapSeries(failures, failure => onError({ ...failure, clientId }))
    event.messages = successes.map(s => s.message)
    const count = event.messages.length
    if (!count) return

    logger.debug(`preprocessed ${count} messages`)
    await next()
    await Promise.mapSeries(successes, success => onSuccess({ ...success, clientId }))
  }
}
