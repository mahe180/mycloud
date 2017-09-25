const promisify = require('pify')
const proc = promisify(require('child_process'))
const fs = promisify(require('fs'))
const co = require('co').wrap
const YAML = require('js-yaml')
const extend = require('xtend/mutable')
const debug = require('debug')('tradle:sls:cli:utils')
const stack = require('./stack')
const tradle = require('../')
const {
  addResourcesToEnvironment,
  addResourcesToOutputs,
  removeResourcesThatDontWorkLocally,
} = require('./compile')

const { aws, init } = tradle
const { s3 } = aws
const { ensureInitialized } = init
const genLocalResources = co(function* () {
  const { aws, resources, init } = tradle
  const { Resources } = stack
  const tables = []
  const buckets = []
  Object.keys(Resources)
    .filter(name => Resources[name].Type === 'AWS::DynamoDB::Table')
    .forEach(name => {
      const { Type, Properties } = Resources[name]
      if (Properties.StreamSpecification) {
        Properties.StreamSpecification.StreamEnabled = true
      }

      tables.push(
        aws.dynamodb.createTable(Properties).promise()
          .then(() => debug(`created table: ${name}`))
          .catch(err => {
            if (err.name !== 'ResourceInUseException') {
              throw err
            }
          })
      )
    })

  Object.keys(resources.Bucket).forEach(name => {
    const Bucket = resources.Bucket[name]
    buckets.push(
      aws.s3.createBucket({ Bucket }).promise()
        .then(() => debug(`created bucket: ${name}`))
    )
  })

  yield buckets
  yield tables
  yield ensureInitialized()
})

const makeDeploymentBucketPublic = co(function* () {
  const serverlessYml = require('./serverless-yml')
  const { service, custom } = serverlessYml
  const { Buckets } = yield s3.listBuckets().promise()
  const Bucket = Buckets.find(bucket => {
    return new RegExp(`${service}-${custom.stage}-serverlessdeploymentbucket`)
      .test(bucket.Name)
  }).Name

  yield makePublic(Bucket)
})

const makePublic = co(function* (Bucket) {
  yield s3.putBucketPolicy({
    Bucket,
    Policy: `{
      "Version": "2012-10-17",
      "Statement": [{
        "Sid": "MakeItPublic",
        "Effect": "Allow",
        "Principal": "*",
        "Action": "s3:GetObject",
        "Resource": "arn:aws:s3:::${Bucket}/*"
      }]
    }`
  }).promise()

  // yield s3.putBucketAcl({
  //   Bucket,
  //   ACL: 'public-read'
  // }).promise()
})

const interpolateTemplate = co(function* (opts) {
  const command = 'sls print ' + Object.keys(opts)
    .map(key => {
      return `--${key}="${opts[key]}"`
    })
    .join(' ')

  console.log(command)
  return proc.exec(command, {
    cwd: process.cwd()
  })
  .then(buf => buf.toString())
})

const compileTemplate = co(function* (path) {
  const file = yield fs.readFile(path, { encoding: 'utf8' })
  const yaml = YAML.load(file)
  const isLocal = process.env.IS_LOCAL
  if (isLocal) {
    removeResourcesThatDontWorkLocally(yaml)
  }

  addResourcesToEnvironment(yaml)
  addResourcesToOutputs(yaml)
  return YAML.dump(yaml)
})

module.exports = {
  compileTemplate,
  interpolateTemplate,
  genLocalResources,
  makeDeploymentBucketPublic
}
