const debug = require('debug')('tradle:sls:db-utils')
const { marshalItem, unmarshalItem } = require('dynamodb-marshaler')
const { NotFound } = require('./errors')
const aws = require('./aws')
const { co, pick, logify, timestamp, wait, clone } = require('./utils')
const { prettify } = require('./string-utils')
const { DEV } = require('./env')
const Errors = require('./errors')
const CONSISTENT_READ_EVERYTHING = true

function getTable (TableName) {
  const tableAPI = {
    toString: () => TableName,
    batchPut: batchPutToTable
  }

  const api = {
    get,
    put,
    update,
    del,
    findOne,
    find,
    scan,
    create: createTable,
    createTable,
    destroy: deleteTable,
    deleteTable,
    query: find,
    queryOne: findOne
  }

  // aliases
  Object.keys(api).forEach(method => {
    tableAPI[method] = (params={}) => {
      params.TableName = TableName
      debug(`performing "${method}" on ${TableName}: ${prettify(params)}`)
      return api[method](params)
    }
  })

  return logify(tableAPI, { log: debug, logInputOutput: DEV })

  function batchPutToTable (items) {
    return batchPut({
      RequestItems: {
        [TableName]: items.map(Item => {
          return {
            PutRequest: { Item }
          }
        })
      }
    })
  }
}

const exec = co(function* exec (method, params) {
  params.ReturnConsumedCapacity = 'TOTAL'
  const result = aws.docClient[method](params).promise()
  logCapacityConsumption(method, result)
  return result
})

const dynamoDBExec = function dynamoDBExec (method, params) {
  return aws.dynamodb[method](params).promise()
}

const createTable = params => dynamoDBExec('createTable', params)
const deleteTable = params => dynamoDBExec('deleteTable', params)

const get = co(function* (params) {
  maybeForceConsistentRead(params)
  const result = yield exec('get', params)
  if (!result.Item) {
    throw new NotFound(JSON.stringify(pick(params, ['TableName', 'Key'])))
  }

  // debug(`got item from ${params.TableName}: ${prettify(result)}`)
  return result.Item
})

const put = co(function* (params) {
  const result = yield exec('put', params)
  return tweakReturnValue(params, result)
})

const del = co(function* (params) {
  const result = yield exec('delete', params)
  return tweakReturnValue(params, result)
})

const find = co(function* (params) {
  maybeForceConsistentRead(params)
  const result = yield exec('query', params)
  return result.Items
})

const findOne = co(function* (params) {
  params.Limit = 1
  const results = yield find(params)
  if (!results.length) {
    throw new NotFound(`"${params.TableName}" query returned 0 items`)
  }

  return results[0]
})

const update = co(function* (params) {
  const result = yield exec('update', params)
  return tweakReturnValue(params, result)
})

function maybeForceConsistentRead (params) {
  // ConsistentRead not supported on GlobalSecondaryIndexes
  if (CONSISTENT_READ_EVERYTHING && !params.IndexName && !params.ConsistentRead) {
    params.ConsistentRead = true
    debug('forcing consistent read')
  }
}

function tweakReturnValue (params, result) {
  debug(`consumed ${result.ConsumedCapacity} capacity units`)

  if (params.ReturnValues !== 'NONE') {
    return result.Attributes
  }

  return result
}

function getUpdateParams (item) {
  const keys = Object.keys(item)
  const toSet = keys.filter(key => item[key] != null)
  const toRemove = keys.filter(key => item[key] == null)

  let UpdateExpression = ''
  if (toSet.length) {
    const ops = toSet.map(key => `#${key} = :${key}`).join(', ')
    UpdateExpression += `SET ${ops} `
  }

  if (toRemove.length) {
    const ops = toRemove.map(key => `#${key}`).join(', ')
    UpdateExpression += `REMOVE ${ops} `
  }

  UpdateExpression = UpdateExpression.trim()
  if (!UpdateExpression.length) {
    throw new Error('nothing was updated!')
  }

  const ExpressionAttributeNames = {}
  const ExpressionAttributeValues = {}
  for (let key in item) {
    ExpressionAttributeNames[`#${key}`] = key
    if (toSet.indexOf(key) !== -1) {
      ExpressionAttributeValues[`:${key}`] = item[key]
    }
  }

  return {
    ExpressionAttributeNames,
    ExpressionAttributeValues,
    UpdateExpression
  }
}

const scan = co(function* (params) {
  maybeForceConsistentRead(params)
  const { Items } = yield exec('scan', params)
  return Items
})

const rawBatchPut = co(function* (params) {
  return yield exec('batchWrite', params)
})

// const create = co(function* (schema) {
//   try {
//     yield dynamodb.createTable(schema).promise()
//   } catch (err) {
//     // already exists
//     if (err.code !== 'ResourceInUseException') {
//       throw err
//     }
//   }
// })

const batchPut = co(function* (params, backoffOptions={}) {
  params = clone(params)

  const {
    backoff=defaultBackoffFunction,
    maxTries=6
  } = backoffOptions

  let tries = 0
  let start = Date.now()
  let time = 0
  let failed
  while (tries < maxTries) {
    let result = yield rawBatchPut(params)
    failed = result.UnprocessedItems
    if (!(failed && Object.keys(failed).length > 0)) return

    params.RequestItems = failed
    yield wait(backoff(tries++))
  }

  const err = new Errors.BatchPutFailed()
  err.failed = failed
  err.attempts = tries
  throw err
})

function jitter (val, percent) {
  // jitter by val * percent
  return val * (1 + 2 * percent * Math.random() - percent)
}

function defaultBackoffFunction (retryCount) {
  const delay = Math.pow(2, retryCount) * 500
  return Math.min(jitter(delay, 0.1), 10000)
}

function getRecordsFromEvent (event, oldAndNew) {
  return event.Records.map(record => {
    const { NewImage, OldImage } = record.dynamodb
    if (oldAndNew) {
      return {
        old: OldImage && unmarshalItem(OldImage),
        new: NewImage && unmarshalItem(NewImage)
      }
    }

    return NewImage && unmarshalItem(NewImage)
  })
  .filter(data => data)
}

function logCapacityConsumption (method, result) {
  let type
  switch (method) {
  case 'get':
  case 'query':
  case 'scan':
    type = 'RCU'
    break
  default:
    type = 'WCU'
    break
  }

  if (result.ConsumedCapacity) {
    debug(`consumed ${result.ConsumedCapacity.CapacityUnits} ${type}s`)
  }
}

module.exports = {
  createTable,
  deleteTable,
  get,
  put,
  update,
  del,
  find,
  findOne,
  batchPut,
  getUpdateParams,
  marshalDBItem: marshalItem,
  unmarshalDBItem: unmarshalItem,
  getTable,
  getRecordsFromEvent
}
