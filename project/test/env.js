console.warn('make sure localstack is running')

process.env.NODE_ENV = 'test'
process.env.IS_LOCAL = true
process.env.SERVERLESS_STAGE = 'test'
process.env.SERVERLESS_SERVICE = 'tradle'

;[
  'Seals',
  'PubKeys',
  'Events',
  'Inbox',
  'Outbox',
  'Presence',
  'Users'
].forEach(table => {
  process.env[`R_TABLE_${table}`] = `${table}Test`
})

;[
  'Objects',
  'Secrets',
  'PublicConf',
].forEach(bucket => {
  process.env[`R_BUCKET_${bucket}`] = `${bucket}Test`
})

;[
  'bot_onmessage',
  'bot_onsealevent'
].forEach(fn => {
  process.env[`R_FUNCTION_${fn}`] = `${fn}Test`
})
