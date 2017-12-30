require('./env').install()

// const awsMock = require('aws-sdk-mock')
import _ = require('lodash')
import AWS = require('aws-sdk')
AWS.config.paramValidation = false

import yn = require('yn')
import test = require('tape')
import pify = require('pify')
import ecdsa = require('nkey-ecdsa')
import sinon = require('sinon')
import tradle = require('@tradle/engine')
import {
  extractSigPubKey,
  exportKeys,
  getSigningKey,
  sign,
  getLink,
  withLinks
} from '../crypto'

import { loudAsync, co, typeforce, pickVirtual, omitVirtual } from '../utils'
import Errors = require('../errors')
import {
  SIG,
  SEQ,
  PREV_TO_RECIPIENT,
  TYPE,
  TYPES
} from '../constants'

import { createTestTradle } from '../'
import types = require('../typeforce-types')

const { newIdentity } = tradle.utils
const { MESSAGE } = TYPES
const { identities, messages, objects, provider } = createTestTradle()
const { createSendMessageEvent, createReceiveMessageEvent } = provider
const fromBobToAlice = require('./fixtures/alice/receive.json')
  .map(messages.normalizeInbound)

const fromAliceToBob = require('./fixtures/bob/receive.json')
  .map(messages.normalizeInbound)

const promiseNoop = () => Promise.resolve()

const [alice, bob] = ['alice', 'bob'].map(name => {
  const identity = require(`./fixtures/${name}/identity`)
  return {
    identity: withLinks(identity),
    // object: identity,
    // link: getLink(identity),
    // permalink: getLink(identity),
    keys: require(`./fixtures/${name}/keys`)
  }
})

test('extract pub key', function (t) {
  const { identity } = alice
  const { curve, pub } = extractSigPubKey(identity)
  const expected = identity.pubkeys.find(key => {
    return key.purpose === 'update'
  })

  t.equal(curve, expected.curve)
  t.equal(pub, expected.pub)

  identity.blah = 'blah'
  try {
    extractSigPubKey(identity)
    t.fail('validated invalid signature')
  } catch (err) {
    t.ok(err instanceof Errors.InvalidSignature)
  }

  t.end()
})

test('createSendMessageEvent', loudAsync(async (t) => {
  // t.plan(3)

  const payload = {
    [TYPE]: 'tradle.SimpleMessage',
    message: 'hey bob',
    // embed: 'data:image/jpeg;base64,somebase64'
  }

  const stub = stubber()
  stub(identities, 'byPermalink', mocks.byPermalink)

  let nextSeq = 0
  let prevMsgLink = 'abc'
  const stubLastSeqAndLink = sinon.stub(messages, 'getLastSeqAndLink')
    .callsFake(() => Promise.resolve({
      seq: nextSeq - 1,
      link: prevMsgLink
    }))

  const stubPutObject = stub(objects, 'put', function (object) {
    t.ok(object[SIG])
    payload[SIG] = object[SIG]
    t.same(omitVirtual(object), payload)
    return Promise.resolve()
  })

  // const stubReplaceEmbeds = stub(objects, 'replaceEmbeds', promiseNoop)

  // Events.putEvent = function (event) {
  //   t.equal(event.topic, 'send')
  //   // console.log(event)
  //   return Promise.resolve()
  // }

  let stoleSeq
  const stubPutMessage = stub(messages, 'putMessage', co(function* (message) {
    typeforce(types.message, message)
    t.notOk(message._inbound)
    t.equal(message[SEQ], nextSeq)
    t.equal(message[PREV_TO_RECIPIENT], prevMsgLink)
    if (!stoleSeq) {
      nextSeq++
      stoleSeq = true
      const err:any = new Error()
      err.code = 'ConditionalCheckFailedException'
      throw err
    }

    t.end()
  }))

  const event = await createSendMessageEvent({
    time: Date.now(),
    author: alice,
    recipient: bob.identity._permalink,
    object: payload
  })

  t.equal(stubPutObject.callCount, 1)
  // t.equal(stubReplaceEmbeds.callCount, 1)
  t.equal(stubPutMessage.callCount, 2)
  t.equal(stubLastSeqAndLink.callCount, 2)
  stub.restore()

  // Events.putEvent = putEvent

  // TODO: compare

  // t.end()
}))

test('createReceiveMessageEvent', loudAsync(async (t) => {
  const message = fromBobToAlice[0]
  const stub = stubber()
  const stubGetIdentity = stub(
    identities,
    'metaByPub',
    mocks.metaByPub
  )

  const stubPutObject = stub(objects, 'put', function (object) {
    t.ok(object[SIG])
    t.same(object, message.object)
    return Promise.resolve()
  })

  const stubTimestampInc = stub(
    messages,
    'assertTimestampIncreased',
    promiseNoop
  )

  const stubGetInbound = stub(messages, 'getInboundByLink', function (link) {
    throw new Errors.NotFound()
  })

  const stubPutMessage = stub(messages, 'putMessage', function (message) {
    t.equal(message._inbound, true)
    typeforce(types.message, message)
    // console.log(event)
    return Promise.resolve()
  })

  await createReceiveMessageEvent({ message })
  t.equal(stubPutMessage.callCount, 1)
  t.equal(stubPutObject.callCount, 1)
  t.equal(stubGetIdentity.callCount, 2)
  t.equal(stubGetInbound.callCount, 0)
  t.equal(stubTimestampInc.callCount, yn(process.env.NO_TIME_TRAVEL) ? 1 : 0)
  stub.restore()
  // TODO: compare

  t.end()
}))

// only makes sense in the single-messages-table implementation
// (vs Inbox+Outbox)
// test.skip('getLastMessageFrom/To', loudAsync(async (t) => {
//   // start fresh
//   try {
//     await messages.table.destroy()
//   } catch (err) {}

//   await messages.table.create()

//   console.log('ALICE', alice.identity._permalink)
//   console.log('BOB', bob.identity._permalink)
//   for (let message of fromBobToAlice) {
//     message = clone(message)
//     message._inbound = true
//     await messages.putMessage(message)
//     const last = await messages.getLastMessageFrom({
//       author: bob.identity._permalink,
//       body: false
//     })

//     t.same(last, messages.stripData(message))
//   }

//   for (let message of fromAliceToBob) {
//     await messages.putMessage(message)
//     const last = await messages.getLastMessageTo({
//       recipient: bob.identity._permalink,
//       body: false
//     })

//     t.same(last, messages.stripData(message))
//   }

//   t.end()
// }))

// test('strip data', function (t) {
//   const time = Date.now()
//   const message = {
//     time,
//     link: 'a',
//     permalink: 'b',
//     author: 'c',
//     recipient: 'd',
//     sigPubKey: 'd1',
//     object: {
//       time,
//       [SIG]: 'asdjklasdjklsa',
//       [TYPE]: MESSAGE,
//       [SEQ]: 1,
//       context: 'abc',
//       object: {
//         [SIG]: 'sadjdlksa',
//         [TYPE]: 'tradle.SimpleMessage',
//         message: 'hey hey'
//       },
//       recipientPubKey: {
//         curve: 'p256',
//         pub: new Buffer('beefface', 'hex')
//       }
//     }
//   }

//   const wrapper = {
//     message,
//     payload: objects.addLinks({
//       author: message.author,
//       object: message.object.object
//     })
//   }

//   console.log(messages.stripData(wrapper))
//   t.same(messages.stripData(wrapper))
// })

// test.only('sign/verify1', function (t) {
//   const key = ecdsa.genSync({ curve: 'p256' })
//   const KeyEncoder = require('key-encoder')
//   const encoder = new KeyEncoder('p256')
//   console.log(encoder.encodePublic(new Buffer(key.toJSON().pub, 'hex'), 'raw', 'pem'))
//   console.log(exportKeys([key])[0].encoded.pem.pub)
//   // console.log(key.toJSON(true))
//   // const data = new Buffer('some shit')
//   // const sig = key.signSync(data)
//   // console.log(key.verifySync(data, sig))
// })

// test('sign/verify', loudAsync(async (t) => {
//   const carol = await pify(newIdentity)({ networkName: 'testnet' })
//   const exported = carol.keys.map(key => key.toJSON(true))
//   console.log(exported.find(key => key.curve === 'p256'))
//   const keys = exportKeys(carol.keys)
//   const key = getSigningKey(keys)
//   const object = {
//     _t: 'tradle.SimpleMessage',
//     message: 'hey'
//   }

//   const signed = await sign({ key, object })
//   const pub = extractSigPubKey(signed.object)
//   t.same(pub.pub, key.pub)
//   t.end()
// }))

// test.only('handshake', loudAsync(async (t) => {
//   const client =
//   await onRequestTemporaryIdentity({ accountId: 'abc', clientId })

// }))

const mocks = {
  byPermalink: co(function* (permalink) {
    if (permalink === alice.identity._permalink) {
      return alice.identity
    }
    if (permalink === bob.identity._permalink) {
      return bob.identity
    }

    throw new Errors.NotFound('identity not found by permalink: ' + permalink)
  }),
  byPub: co(function* (pub) {
    const found = [alice, bob].find(info => {
      return info.identity.pubkeys.some(key => key.pub === pub)
    })

    if (found) return found.identity

    throw new Errors.NotFound('identity not found by pub: ' + pub)
  }),
  metaByPub: co(function* (pub) {
    const found = [alice, bob].find(info => {
      return info.identity.pubkeys.some(key => key.pub === pub)
    })

    if (found) {
      return {
        link: found.identity._link,
        permalink: found.identity._permalink
      }
    }

    throw new Errors.NotFound('identity not found by pub: ' + pub)
  })
}

function stubber () {
  const stubs = []
  const stub:any = (obj, prop, fn) => {
    const thisStub = sinon.stub(obj, prop).callsFake(fn)
    stubs.push(thisStub)
    return thisStub
  }

  stub.restore = () => stubs.forEach(stub => stub.restore())
  return stub
}
