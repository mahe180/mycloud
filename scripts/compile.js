#!/usr/bin/env node

const debug = require('debug')('tradle:sls:compile')
const YAML = require('js-yaml')
const fs = require('fs')
const file = fs.readFileSync(process.argv[2], { encoding: 'utf8' })
const yaml = YAML.load(file)

function forEachResource (yaml, fn) {
  const { resources, provider } = yaml
  const { Resources } = resources
  const { environment } = provider

  let updated
  for (let logicalId in Resources) {
    fn({
      id: logicalId,
      resource: Resources[logicalId]
    })
  }

  fn({
    id: 'ServerlessDeploymentBucket',
    resource: {
      Type: 'AWS::S3::Bucket'
    }
  })
}

function addResourcesToEnvironment (yaml) {
  const { provider } = yaml
  if (!provider.environment) provider.environment = {}

  const { environment } = provider
  forEachResource(yaml, ({ id, resource }) => {
    if (id in environment) {
      throw new Error(`refusing to overwrite environment.${id}`)
    }

    const type = resource.Type.split('::').pop()
    let shortName = id
    if (id.endsWith(type)) {
      shortName = shortName.slice(0, id.length - type.length)
    }

    environment[`R_${type}_${shortName}`.toUpperCase()] = {
      Ref: id
    }
  })
}

function addResourcesToOutputs (yaml) {
  const { resources } = yaml
  if (!resources.Outputs) resources.Outputs = {}

  const { Outputs } = resources
  forEachResource(yaml, ({ id, resource }) => {
    if (id in Outputs) {
      throw new Error(`refusing to overwrite Outputs.${id}`)
    }

    const output = Outputs[id] = {}
    if (resource.Description) {
      output.Description = resource.Description
    }

    output.Value = {
      Ref: id
    }
  })
}

addResourcesToEnvironment(yaml)
addResourcesToOutputs(yaml)
process.stdout.write(YAML.dump(yaml))

// const fs = require('fs')
// const file = fs.readFileSync(process.argv[2] || 'serverless.yml', { encoding: 'utf8' })
// const lines = file.split('\n')

// function getResources (lines) {
//   const level0BlockRegex = /^[^ ]+/
//   const level2BlockRegex = /^[ ]{4}[^\s#]+/
//   const start = lines.findIndex(line => line === 'resources:')
//   const fromResources = lines.slice(start + 1)

//   const n = fromResources.findIndex(line => line.match(level0BlockRegex))
//   const end = n === -1 ? fromResources.length : n
//   return fromResources.slice(0, end)
//     .filter(line => line.match(level2BlockRegex))
// }

// function getEnvironmentLocation (lines) {
//   const providerIdx = lines.findIndex(line => line === 'provider:')
//   const environmentIdx = lines.slice(providerIdx).findIndex(line => line === '  environment:')
//   return environmentIdx
// }

// function getEnvironmentLines (lines) {

// }

// function addResources (lines) {
//   const idx = getEnvironmentLocation(lines)

// }

// console.log(getEnvironmentLocation(lines))
