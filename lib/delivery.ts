import { EventEmitter } from 'events'
import * as DeliveryMQTT from './delivery-mqtt'
import DeliveryHTTP from './delivery-http'
import { IDelivery } from './types'
import { clone, pick } from './utils'
import Env from './env'
import LambdaUtils from './lambda-utils'

const debug = require('debug')('tradle:sls:delivery')
const MAX_BATCH_SIZE = 5

function normalizeOpts (opts) {
  if (!opts.recipient && opts.message) {
    opts.recipient = opts.message._author
  }

  return opts
}

function withTransport (method: string) {
  return async function (opts: any) {
    opts = normalizeOpts({ ...opts, method })
    const transport = await this.getTransport(opts)
    return transport[method](opts)
  }
}

export default class Delivery extends EventEmitter implements IDelivery {
  private mqtt: any
  private http: DeliveryHTTP
  private friends: any
  private messages: any
  private objects: any
  private env: Env
  private lambdaUtils: LambdaUtils
  private _deliverBatch = withTransport('deliverBatch')

  constructor (opts) {
    super()

    const { friends, messages, objects, env, lambdaUtils } = opts
    this.messages = messages
    this.objects = objects
    this.friends = friends
    this.http = new DeliveryHTTP(opts)
    this.mqtt = new DeliveryMQTT(opts)
    this.env = env
    this.lambdaUtils = lambdaUtils
  }

  public ack = withTransport('ack')
  public reject = withTransport('reject')

  public deliverBatch = async (opts: { messages: Array<any> })  => {
    const { messages } = opts
    messages.forEach(object => this.objects.presignEmbeddedMediaLinks({ object }))
    return this._deliverBatch(opts)
  }

  public async deliverMessages (opts) {
    opts = clone(opts)
    let {
      recipient,
      gt=0,
      lt=Infinity,
      afterMessage
    } = opts

    debug(`looking up messages for ${recipient} > ${gt}`)
    while (true) {
      let batchSize = Math.min(lt - gt - 1, MAX_BATCH_SIZE)
      if (batchSize <= 0) return

      let messages = await this.messages.getMessagesTo({
        recipient,
        gt,
        afterMessage,
        limit: batchSize,
        body: true,
      })

      debug(`found ${messages.length} messages for ${recipient}`)
      if (!messages.length) return

      // if (this.env.getRemainingTimeInMillis() < 2000) {
      //   debug('recursing delivery')
      //   return this.lambdaUtils.invoke({
      //     name: this.env.AWS_LAMBDA_FUNCTION_NAME,
      //     arg: this.env.event
      //   })
      // }

      await this.deliverBatch({ ...opts, messages })

      // while (messages.length) {
      //   let message = messages.shift()
      //   await deliverMessage({ clientId, recipient, message })
      // }

      let last = messages[messages.length - 1]
      afterMessage = pick(last, ['_recipient', 'time'])
    }
  }

  public async getTransport (opts: {
    method: string,
    recipient: string,
    clientId?: string,
    friend?: any
  }) {
    const { method, recipient, clientId, friend } = opts
    if (clientId || !(method in this.http)) {
      return this.mqtt
    }

    if (friend || !(method in this.mqtt)) {
      return this.http
    }

    try {
      opts.friend = await this.friends.get({ permalink: recipient })
      return this.http
    } catch (err) {
      debug(`cannot determine transport to use for recipient ${recipient}`)
      throw err
    }
  }
}
