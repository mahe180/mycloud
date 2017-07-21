require('./env')

const test = require('tape')
const Tradle = require('../')
const { clone } = require('../lib/utils')
const createRealBot = require('../lib/bot')
const createFakeBot = require('./mock/bot')
// const messages = require('../lib/messages')
const { co, loudCo, pick, wait } = Tradle.utils
const { toStreamItems, recreateTable } = require('./utils')
const Errors = require('../lib/errors')
// const seals = require('../lib/seals')
const aliceKeys = require('./fixtures/alice/keys')
const bob = require('./fixtures/bob/object')
// const fromBob = require('./fixtures/alice/receive.json')
const schema = require('../conf/table/users').Properties
const BaseBotModels = require('../lib/bot/base-models')

;[createFakeBot, createRealBot].forEach((createBot, i) => {
  const mode = createBot === createFakeBot ? 'mock' : 'real'
  test('await ready', loudCo(function* (t) {
    const bot = createBot({})
    const expectedEvent = toStreamItems([
      {
        old: {
          link: 'a',
          unsealed: 'x'
        },
        new: {
          link: 'b'
        }
      }
    ])

    let waited
    bot.onsealevent(co(function* (event) {
      t.equal(waited, true)
      t.equal(event, expectedEvent)
      t.end()
    }))

    bot.call('onsealevent', expectedEvent).catch(t.error)

    yield wait(100)
    waited = true
    bot.ready()
  }))

  test(`users (${mode})`, loudCo(function* (t) {
    if (mode === 'real') {
      yield recreateTable(schema)
    }

    const bot = createBot({})
    const { users } = bot
    // const user : Object = {
    const user = {
      id: bob.permalink,
      identity: bob.object
    }

    const promiseOnCreate = new Promise(resolve => {
      bot.onusercreate(resolve)
    })

    bot.ready()

    t.same(yield users.createIfNotExists(user), user, 'create if not exists')
    t.same(yield users.get(user.id), user, 'get by primary key')

    // doesn't overwrite
    yield users.createIfNotExists({
      id: user.id
    })

    t.same(yield promiseOnCreate, user)
    t.same(yield users.get(user.id), user, '2nd create does not clobber')
    t.same(yield users.list(), [user], 'list')

    user.name = 'bob'
    t.same(yield users.merge(user), user, 'merge')
    t.same(yield users.get(user.id), user, 'get after merge')
    t.same(yield users.del(user.id), user, 'delete')
    t.same(yield users.list(), [], 'list')
    t.end()
  }))

  test(`onmessage (${mode})`, loudCo(function* (t) {
    t.plan(5)

    const tradle = Tradle.new()
    const { objects, messages, identities } = tradle
    const bot = createBot({ tradle })
    const { users } = bot

    let updatedUser
    users.merge = co(function* () {
      updatedUser = true
    })

    users.createIfNotExists = co(function* (user) {
      t.equal(user.id, message._author)
      return user
    })

    // const { getIdentityByPermalink } = identities
    const { getObjectByLink } = objects
    const payload = {
      _link: 'b',
      _t: 'a',
      _s: 'sig',
      _author: 'carol',
      _virtual: ['_author', '_link']
    }

    const message = {
      time: 123,
      _author: 'bob',
      _recipient: 'alice',
      _link: 'a',
      object: payload,
      _virtual: ['_author', '_recipient', '_link']
    }

    objects.getObjectByLink = co(function* (link) {
      if (link === message._link) {
        return message.object
      } else if (link === payload._link) {
        return payload
      }

      throw new Errors.NotFound(link)
    })

    // identities.getIdentityByPermalink = co(function* (permalink) {
    //   t.equal(permalink, message.author)
    //   return bob.object
    // })

    bot.onmessage(co(function* (data) {
      const { user } = data
      user.bill = 'ted'
      t.equal(user.id, message._author)
      t.same(data.message, message)
      t.same(data.payload, payload)
    }))

    // const conversation = yield bot.users.history('bob')
    // console.log(conversation)

    bot.ready()

    yield bot.call('onmessage', message)
    t.equal(updatedUser, true)
    objects.getObjectByLink = getObjectByLink
    // identities.getIdentityByPermalink = getIdentityByPermalink
  }))

  test(`onreadseal (${mode})`, loudCo(function* (t) {
    const link = '7f358ce8842a2a0a1689ea42003c651cd99c9a618d843a1a51442886e3779411'

    let read
    let wrote
    const tradle = Tradle.new()
    const { seals, provider } = tradle
    const { getMyKeys } = provider
    provider.getMyKeys = () => Promise.resolve(aliceKeys)

    seals.create = co(function* ({ key, link }) {
      yield bot.call('onsealevent', toStreamItems([
        {
          old: {
            link,
            unsealed: 'x'
          },
          new: {
            link
          }
        },
        {
          old: {
            link,
            unconfirmed: 'x'
          },
          new: {
            link
          }
        }
      ]))
    })

    const bot = createBot({ tradle })
    bot.onreadseal(co(function* (event) {
      read = true
      t.equal(event.link, link)
    }))

    bot.onwroteseal(co(function* (event) {
      wrote = true
      t.equal(event.link, link)
    }))

    bot.ready()

    yield bot.seal({ link })

    t.equal(read, true)
    t.equal(wrote, true)

    provider.getMyKeys = getMyKeys
    t.end()
  }))

  test(`use() (${mode})`, loudCo(function* (t) {
    const expectedArg = {}
    const called = {
      onusercreate: false,
      onuseronline: false,
      onreadseal: false,
      onwroteseal: false
    }

    const bot = createBot({})
    bot.use(() => {
      Object.keys(called).forEach(method => {
        bot[method](co(function* (arg) {
          t.equal(arg, expectedArg)
          called[method] = true
        }))
      })
    })

    bot.ready()

    for (let method in called) {
      yield bot.call(method, expectedArg)
      t.equal(called[method], true)
    }

    t.end()
  }))
})

test('save to type table', loudCo(function* (t) {
  const message = {
    "_author": "cf9bfbd126553ce71975c00201c73a249eae05ad9030632f278b38791d74a283",
    "_inbound": true,
    "_link": "1843969525f8ecb105ba484b59bb70d3a5d0c38e465f29740fc335e95b766a09",
    "_n": 1,
    "_permalink": "1843969525f8ecb105ba484b59bb70d3a5d0c38e465f29740fc335e95b766a09",
    "_q": "f58247298ef1e815a39394b5a3e724b01b8e0e3217b89699729b8b0698078d89",
    "_recipient": "9fb7144218332ef152b34d6e38d6479ecb07f2c0b649af1cfe0559f870d137c4",
    "_s": "CkkKBHAyNTYSQQSra+ZW0NbpXhWzsrPJ3jaSmzL4LelVpqFr5ZC+VElHxcOD+8zlS+PuhtQrHB6LJ7KF+d8XtQzgYhVX1FXEBYYREkcwRQIgcF+hp6e5KnVj9VapsvnVkaJ6d3DL84DmJ3UueEHGiQMCIQDr0w0RJXIrLk7O1AgeEeLQfloFslsDzWVcHs4AhOFcrg==",
    "_sigPubKey": "04ab6be656d0d6e95e15b3b2b3c9de36929b32f82de955a6a16be590be544947c5c383fbcce54be3ee86d42b1c1e8b27b285f9df17b50ce0621557d455c4058611",
    "_t": "tradle.Message",
    "_payloadType": "tradle.Ping",
    "_virtual": [
      "_sigPubKey",
      "_link",
      "_permalink",
      "_author",
      "_recipient"
    ],
    "object": {
      "_author": "cf9bfbd126553ce71975c00201c73a249eae05ad9030632f278b38791d74a283",
      "_link": "e886aba619b76982a6eb3ed6e70065d324eddcd9fe1968bf33ea0e59662925c4",
      "_permalink": "e886aba619b76982a6eb3ed6e70065d324eddcd9fe1968bf33ea0e59662925c4",
      "_sigPubKey": "04ab6be656d0d6e95e15b3b2b3c9de36929b32f82de955a6a16be590be544947c5c383fbcce54be3ee86d42b1c1e8b27b285f9df17b50ce0621557d455c4058611",
      "_virtual": [
        "_sigPubKey",
        "_link",
        "_permalink",
        "_author"
      ]
    },
    "recipientPubKey": "p256:04fffcaea5138d242b161f44d7310a20eefbbb2c39d8bed1061ec5df62c568d99eab7a6137cc4829ac4e2159f759dedf38ba34b6f4e42a0d9eb9486226402ed6ec",
    "time": 1500317965602
  }

  const payload = {
    _t: 'tradle.Ping'
  }

  const bot = createFakeBot({})
  bot.objects = {
    get: function (link) {
      t.equal(link, message.object._link)
      return Promise.resolve(payload)
    }
  }

  bot.ready()
  const table = bot.tables['tradle.Ping']
  t.ok(table, 'table created per model')

  table.createTable = function () {
    return Promise.resolve()
  }

  const whole = clone(message.object, payload, {
    _time: message.time
  })

  table.create = function (obj) {
    t.same(obj, whole)
    return Promise.resolve()
  }

  yield bot.call('onmessagestream', toStreamItems([
    { new: message }
  ]))

  const { scan } = table
  table.scan = table.query = function (...args) {
    t.ok('queried table')
    // t.end()
    // const op = scan(...args)
    // op.exec = () => {
    //   return Promise.resolve({
    //     Count: 1,
    //     Items: [whole]
    //   })
    // }

    // return op
  }

  yield bot.exports.ongraphql({
    body: JSON.stringify({
      query: `{
        rl_tradle_Ping {
          _link
        }
      }`
    })
  }, err => {
    t.error(err)
    t.end()
  })
}))

test('validate send', loudCo(function* (t) {
  const tradle = Tradle.new()
  tradle.provider.sendMessage = () => Promise.resolve()

  const models = {
    'ding.bling': {
      id: 'ding.bling',
      title: 'Ding Bling',
      type: 'tradle.Model',
      properties: {
        ding: {
          type: 'string'
        },
        blink: {
          type: 'number'
        }
      },
      required: ['ding']
    }
  }

  const bot = createRealBot({
    tradle,
    models
  })

  bot.ready()
  try {
    yield bot.send({
      to: 'blah',
      object: {}
    })

    t.fail('expected payload validation to fail')
  } catch (err) {
    t.ok(/expected/i.test(err.message))
  }

  // undeclared types are ok
  yield bot.send({
    to: 'blah',
    object: {
      _t: 'sometype'
    }
  })

  // declared types are validated
  try {
    yield bot.send({
      to: 'blah',
      object: {
        _t: 'ding.bling',
      }
    })

    t.fail('validation should have failed')
  } catch (err) {
    t.ok(/required/.test(err.message))
  }

  yield bot.send({
    to: 'blah',
    object: {
      _t: 'ding.bling',
      ding: 'dong'
    }
  })

  t.end()
}))
