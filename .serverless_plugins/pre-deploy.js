const path = require('path')
const AWS = require('aws-sdk')
const Errors = require('@tradle/errors')
const {
  validateTemplatesAtPath,
  uploadTemplatesAtPath
} = require('../lib/cli/utils')
const versionInfo = require('../lib/version')
const templatesDir = path.resolve(__dirname, '../cloudformation')
const stackParameters = require('../vars').stackParameters || require('../default-vars').stackParameters

class SetVersion {
  constructor(serverless, options) {
    this.serverless = serverless
    this.options = options
    this.provider = this.serverless.getProvider('aws')
    this.hooks = {
      'aws:common:validate:validate': () => this.onValidate(),
      'before:package:compileFunctions': () => this.setVersion(),
      'aws:deploy:deploy:uploadArtifacts': async () => {
        await Promise.all([
          this._getBucket().then(bucket => this.uploadTemplates(bucket)),
          this.setTemplateParameters()
        ])
      },
    }
  }

  _service() {
    return this.serverless.service.service
  }

  _stage() {
    return this.options.stage
  }

  _region() {
    return this.options.region
  }

  async _getBucket() {
    const stage = this._stage()
    const region = this._region()
    try {
      return await this.provider.getServerlessDeploymentBucketName(stage, region)
    } catch (err) {
      Errors.rethrow(err, 'developer')
    }
  }

  _dir() {
    return versionInfo.templatesPath
  }

  async setTemplateParameters() {
    const parameterNames = Object.keys(this.serverless.service.provider.compiledCloudFormationTemplate.Parameters)
    const params = (await this.getStackInfo()).Parameters
    Object.keys(stackParameters).forEach(key => {
      if (!parameterNames.includes(key)) {
        this.log(`WARNING: parameter "${key}" specified in "stackParameters" was not found in the template`)
        return
      }

      const param = params.find(({ ParameterKey }) => ParameterKey === key)
      const value = stackParameters[key]
      if (param) {
        param.ParameterValue = value
      } else {
        params.push({
          ParameterKey: key,
          ParameterValue: value,
        })
      }
    })

    this.serverless.service.provider.cloudformationTemplateParameters = params
  }

  async onValidate() {
    await Promise.all([
      this.checkExisting(),
      this.validateTemplates(),
    ])
  }

  async getStackInfo() {
    const { Stacks } = await this.provider.request(
      'CloudFormation',
      'describeStacks',
      {
        StackName: this.provider.naming.getStackName(),
      },
      this._stage(),
      this._region(),
    )

    return Stacks[0]
  }

  async checkExisting() {
    const stage = this._stage()
    const region = this._region()
    const service = this._service()
    const dir = this._dir()
    try {
      await this.getStackInfo()
    } catch (err) {
      if (err.code === 'ValidationError' && err.message.toLowerCase().includes('does not exist')) {
        // if it's a stack create, allow
        return
      }
    }

    const bucketName = await this._getBucket()
    if (!bucketName) return

    const { Contents=[] } = await this.provider.request('S3',
      'listObjectsV2',
      {
        Bucket: bucketName,
        Prefix: dir,
      },
      stage,
      region
    )

    if (Contents.length) {
      throw new Error(`already deployed to ${dir}, please deploy from a fresh commit`)
    }
  }

  _createClient(clName) {
    return new this.provider.sdk[clName](this.provider.getCredentials())
  }

  log(...args) {
    this.serverless.cli.log(...args)
  }

  async validateTemplates() {
    await validateTemplatesAtPath({
      cloudformation: this._createClient('CloudFormation'),
      dir: templatesDir,
    })
  }

  async uploadTemplates(bucket) {
    const prefix = this._dir()

    this.log(`uploading templates to s3://${bucket}/${prefix}`)

    await uploadTemplatesAtPath({
      s3: this._createClient('S3'),
      dir: templatesDir,
      bucket,
      prefix,
      acl: 'public-read',
    })
  }

  setVersion() {
    this.serverless.service.package.artifactDirectoryName = this._dir()
  }
}

module.exports = SetVersion
