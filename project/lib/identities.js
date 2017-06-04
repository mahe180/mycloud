const co = require('co').wrap
const extend = require('xtend/mutable')
const debug = require('debug')('tradle:sls:identities')
const { utils, constants } = require('@tradle/engine')
const { PREVLINK, PERMALINK } = constants
const Objects = require('./objects')
const { get, put, findOne } = require('./db-utils')
const { db, docClient, s3 } = require('./aws')
const { NotFound } = require('./errors')
const { firstSuccess, logifyFunctions } = require('./utils')
const Events = require('./events')
const { PubKeysTable } = require('./env')

function getIdentityMetadataByPub ({ pub }) {
  debug('get identity metadata by pub')
  return get({
    TableName: PubKeysTable,
    Key: { pub }
  })
}

function getIdentityByPub ({ pub }) {
  return getIdentityMetadataByPub({ pub })
  .then(({ link }) => Objects.getObjectByLink(link))
  .catch(err => {
    debug('unknown identity', pub, err)
    throw new NotFound('identity with pub: ' + pub)
  })
}

function getIdentityByPermalink (permalink) {
  const params = {
    TableName: PubKeysTable,
    IndexName: 'permalink',
    KeyConditionExpression: '#permalink = :permalinkValue',
    ExpressionAttributeNames: {
      "#permalink": "permalink"
    },
    ExpressionAttributeValues: {
      ":permalinkValue": permalink
    }
  }

  debug('get identity by permalink')
  return findOne(params)
    .then(({ link }) => Objects.getObjectByLink(link))
}

// function getIdentityByFingerprint ({ fingerprint }) {
//   const params = {
//     TableName: PubKeysTable,
//     IndexName: 'fingerprint',
//     KeyConditionExpression: '#fingerprint = :fingerprintValue',
//     ExpressionAttributeNames: {
//       "#fingerprint": 'fingerprint'
//     },
//     ExpressionAttributeValues: {
//       ":fingerprintValue": fingerprint
//     }
//   }

//   return findOne(params)
//     .then(Objects.getObjectByLink)
// }

function getExistingIdentityMapping ({ object }) {
  debug('checking existing mappings for pub keys')
  const lookups = object.pubkeys.map(getIdentityMetadataByPub)
  return firstSuccess(lookups)
}

// function getExistingIdentityMapping ({ identity }) {
//   const pubKeys = identity.pubkeys.map(pub => pub.pub)
//   const KeyConditionExpression = `#pub IN (${pubKeys.map((pub, i) => `:pubValue${i}`).join(',')})`
//   const ExpressionAttributeValues = {}
//   pubKeys.forEach((pub, i) => {
//     ExpressionAttributeValues[`:pubValue${i}`] = pub
//   })

//   const params = {
//     TableName: PubKeysTable,
//     IndexName: 'permalink',
//     KeyConditionExpression,
//     ExpressionAttributeNames: {
//       "#pub": "pub"
//     },
//     ExpressionAttributeValues
//   }

//   console.log(params)
//   return findOne(params)
// }

const createAddContactEvent = co(function* ({ link, permalink, object }) {
  const result = validateNewContact({ link, permalink, object })
  debug(`queueing add contact ${link}`)
  yield Events.putEvent({
    topic: 'addcontact',
    link: result.link
  })
})

const validateNewContact = co(function* ({ link, permalink, object }) {
  let existing
  try {
    existing = yield getExistingIdentityMapping({ object })
  } catch (err) {}

  const links = utils.getLinks({ link, permalink, object })
  link = links.link
  permalink = links.permalink

  if (existing) {
    if (existing.link === link) {
      debug(`mapping is already up to date for identity ${permalink}`)
      return
    }

    if (object[PREVLINK] !== existing.link) {
      debug('identity mapping collision. Refusing to add contact:', JSON.stringify(object))
      throw new Error(`refusing to add identity with link: "${link}"`)
    }
  }

  return {
    link,
    permalink,
    object
  }
})

const addContact = co(function* ({ link, permalink, object }) {
  if (!object) {
    const result = yield Objects.getObjectByLink(link)
    object = result.object
  }

  const links = utils.getLinks({ link, permalink, object })
  link = links.link
  permalink = links.permalink

  const putPubKeys = object.pubkeys.map(pub => putPubKey({ link, permalink, pub: pub.pub }))
  yield Promise.all(putPubKeys.concat(
    Objects.putObject({ link, permalink, object })
  ))
})

function putPubKey ({ link, permalink, pub }) {
  debug(`adding mapping from pubKey "${pub}" to link "${link}"`)
  return put({
    TableName: PubKeysTable,
    Key: { pub },
    Item: {
      link,
      permalink,
      pub
    }
  })
}

// function addContactPubKeys ({ link, permalink, identity }) {
//   const RequestItems = {
//     [PubKeysTable]: identity.pubkeys.map(pub => {
//       const Item = extend({ link, permalink }, pub)
//       return {
//         PutRequest: { Item }
//       }
//     })
//   }

//   return docClient.batchWrite({ RequestItems }).promise()
// }

module.exports = logifyFunctions({
  getIdentityByLink: Objects.getObjectByLink,
  getIdentityByPermalink,
  getIdentityByPub,
  getIdentityMetadataByPub,
  // getIdentityByFingerprint,
  createAddContactEvent,
  addContact,
  validateNewContact
})
