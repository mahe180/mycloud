const tradleDynamo = require('@tradle/dynamodb')
// const Tables = require('./tables')

export = function createDB (opts: {
  models: any,
  objects: any,
  tables: any,
  aws: any,
  constants: any,
  env: any,
  prefix: string
}) {
  const { models, objects, tables, aws, constants, env, prefix } = opts
  const db = tradleDynamo.db({
    models,
    objects,
    docClient: aws.docClient,
    maxItemSize: constants.MAX_DB_ITEM_SIZE,
    prefix
  })

  // export Outbox only
  const messageModel = models['tradle.Message']
  if (!messageModel.isInterface) {
    const outbox = tradleDynamo.createTable({
      models,
      objects,
      model: messageModel,
      tableName: tables.Outbox.name,
      prefix,
      // better load these from serverless-yml
      hashKey: '_recipient',
      rangeKey: 'time',
      indexes: []
    })

    db.setTableForType('tradle.Message', outbox)
  }

  const pubKeyModel = models['tradle.PubKey']
  const pubKeys = tradleDynamo.createTable({
    models: {
      ...models,
      [pubKeyModel.id]: pubKeyModel
    },
    objects,
    model: pubKeyModel,
    tableName: tables.PubKeys.name,
    prefix,
    hashKey: 'pub',
    indexes: []
  })

  db.setTableForType('tradle.PubKey', pubKeys)
  return db
}
