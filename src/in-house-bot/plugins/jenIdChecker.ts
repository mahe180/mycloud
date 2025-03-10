// @ts-ignore
import fetch from 'node-fetch'
import DataURI from 'strong-data-uri'
import sizeof from 'image-size'
import _ from 'lodash'
import { buildResourceStub } from '@tradle/build-resource'
import constants from '@tradle/constants'
import {
  Bot,
  Logger,
  IPBApp,
  ITradleObject,
  CreatePlugin,
  Applications,
  IPluginLifecycleMethods,
  ValidatePluginConf
} from '../types'

import {
  getParsedFormStubs,
  doesCheckNeedToBeCreated,
  getStatusMessageForCheck,
} from '../utils'

import validateResource from '@tradle/validate-resource'
// @ts-ignore
const { sanitize } = validateResource.utils

const { TYPE } = constants
const { VERIFICATION } = constants.TYPES
const PHOTO_ID = 'tradle.PhotoID'
const STATUS = 'tradle.Status'
const DOCUMENT_CHECKER_CHECK = 'tradle.documentChecker.Check'
const ASPECTS= 'Document authentication and verification'

const PROVIDER = 'jenID Solutions GmbH.'

const CLIENT_ID = '127.0.0.1:55555'

const API_URL = 'https://www.checkid.online/inspectionjob/'


interface IJenIdCheck {
    application: IPBApp
    status: any
    form: ITradleObject
}

interface IJenIdCheckerConf {
    username: string
    password: string
    threshold?: number
    deleteAfter? : boolean
}

const DEFAULT_CONF = {
    username: '',
    password : '',
    threshold : 40,
    deleteAfter : true
}

export class JenIdCheckerAPI {
    private bot:Bot
    private conf:IJenIdCheckerConf
    private logger:Logger
    private applications: Applications
    constructor({ bot, applications, conf, logger }) {
      this.bot = bot
      this.conf = _.defaults(conf || {}, DEFAULT_CONF)
      this.applications = applications
      this.logger = logger
    }

    handleData = async (form, application) => {
        await this.bot.resolveEmbeds(form)

        let buf = DataURI.decode(form.scan.url)
        const scanDimensions = sizeof(buf)

        let jsonFrontInputImage = {
            'image'          : {
                'mmHeight'   : 0,
                'mmWidth'    : 0,
                'imageData'  : form.scan.url,
                'pixelHeight': scanDimensions.height,
                'pixelWidth' : scanDimensions.width,
                'cropped'    : 1
            },
            'metaData'       : {
                'description' : ''
            },
            'inputPageType'  : 'front',
            'inputImageType' : 'visible',
        }

        let jsonInputImages = [ jsonFrontInputImage ]

        if (form.otherSideScan) {
            buf = DataURI.decode(form.otherSideScan.url)
            const backDimensions = sizeof(buf)

            let jsonBackInputImage = {
                'image'          : {
                    'mmHeight'   : 0,
                    'mmWidth'    : 0,
                    'imageData'  : form.otherSideScan.url,
                    'pixelHeight': backDimensions.height,
                    'pixelWidth' : backDimensions.width,
                    'cropped'    : 1
                },
                'metaData'       : {
                    'description' : ''
                },
                'inputPageType'  : 'back',
                'inputImageType' : 'visible',
            }

            jsonInputImages = [ jsonFrontInputImage, jsonBackInputImage ]
        }

        let jsonData = { 'inputData' : {
                'clientID' : CLIENT_ID,
                'description' : '',
                'inputImages' : jsonInputImages,
                'captureDeviceType' : 5
           }
        }

        const data = JSON.stringify(jsonData);
this.logger.debug('JenID: Start getting data')
        let response = await this.post(data, this.conf)
        if (!response.success) {
           const status = {status: 'error', message: response.error, rawData: {}}
           this.logger.debug(`Failed upload data to ${PROVIDER}, error : ${response.error}`);
           return status
        }
        const id = response.data._id
        this.logger.debug(`Posted data to ${PROVIDER}, response id: ${id}`);

        let result
        await this.sleep(4000)
        let timePassed = 4000
        while (true) {
            result = await this.get(id, this.conf)
            if (result.success) {
               if (result.data.status == 128) {
                   break;
               } else {
                  if (timePassed > 60000) {
                     break;
                  }
                  await this.sleep(1000)
                  timePassed += 1000
               }
            }
            else
               break;
        }
        if (result.success) {
            if (this.conf.deleteAfter) {
                let removed = await this.del(id, this.conf)
                this.logger.debug(`Deleting data from ${PROVIDER} for ${ASPECTS}: ${JSON.stringify(removed.data)}`);
            }

            // preserve as raw data only documentresult
            result.data = result.data.outputData.resultJson.documentresult

            result.data = sanitize(result.data).sanitized

            let securitystatus = result.data.securitystatus
            let processingstatus = result.data.processingstatus
            this.logger.debug(`Received data from ${PROVIDER} with security status: ${JSON.stringify(securitystatus)}`);

            if (processingstatus.code !== '0') {
                return {
                    status: 'fail',
                    message: `Check failed: ${processingstatus.short}`,
                    rawData : result.data
                }
            }
            else if (+securitystatus.overallriskvalue >= this.conf.threshold) {
                return {
                   status: 'fail',
                   message: `Check failed: ${securitystatus.statusdescription}`,
                   rawData : result.data
                }
            }
            return  {
                status: 'pass',
                message: `Check passed: ${securitystatus.statusdescription}`,
                rawData : result.data
            }
        }
        else {
            const status = {status: 'error', message: response.error, rawData: {}}
            this.logger.debug(`Failed get data from ${PROVIDER}, error : ${response.error}`);
            return status
        }

    }

    createCheck = async ({ application, status, form }: IJenIdCheck) => {
        let resource:any = {
          [TYPE]: DOCUMENT_CHECKER_CHECK,
          status: status.status,
          provider: PROVIDER,
          application: buildResourceStub({resource: application, models: this.bot.models}),
          dateChecked: Date.now(),
          aspects: ASPECTS,
          form
        }
        resource.message = getStatusMessageForCheck({models: this.bot.models, check: resource})
        if (status.message)
          resource.resultDetails = status.message
        if (status.rawData)
          resource.rawData = status.rawData

        this.logger.debug(`Creating ${PROVIDER} check for ${ASPECTS}`);
        const check = await this.bot.draft({ type: DOCUMENT_CHECKER_CHECK })
            .set(resource)
            .signAndSave()
        this.logger.debug(`Created ${PROVIDER} check for ${ASPECTS}`);
    }

    createVerification = async ({ application, form, rawData }) => {
        const method:any = {
          [TYPE]: 'tradle.APIBasedVerificationMethod',
          api: {
            [TYPE]: 'tradle.API',
            name: PROVIDER
          },
          aspect: 'document validity',
          reference: [{ queryId: 'report:' + rawData._id }],
          rawData: rawData
        }

        const verification = this.bot.draft({ type: VERIFICATION })
           .set({
             document: form,
             method
           })
           .toJSON()

        await this.applications.createVerification({ application, verification })
        this.logger.debug(`Created ${PROVIDER} verification for ${ASPECTS}`);
        if (application.checks)
          await this.applications.deactivateChecks({ application, type: DOCUMENT_CHECKER_CHECK, form })
    }

    post = async (data: string, conf: IJenIdCheckerConf) => {
        let auth = new Buffer(conf.username + ':' + conf.password);
        let basicAuth = auth.toString('base64');
        try {
          const res = await fetch(API_URL+'create', {
             method: 'POST',
             body: data,
             headers: {
               'Content-Type': 'application/json; charset=utf-8',
               'Content-Length': data.length,
               'Authorization' : 'Basic '+ basicAuth,
               'Accept' : 'application/json',
             }
          });

          if (res.ok) {
            const result = await res.json()
            return {
               success : true,
               data : result
            }
          } else {
            return {success : false, error: 'unknown problem'}
          }
        } catch (err) {
          return {success: false, error: err.message}
        }
    }

    get = async (id: string, conf: IJenIdCheckerConf) => {
        let auth = new Buffer(conf.username + ':' + conf.password);
        let basicAuth = auth.toString('base64');
        try {
          const res = await fetch(API_URL+id, {
             method: 'GET',
             headers: {
               'Authorization' : 'Basic '+ basicAuth,
               'Accept' : 'application/json',
             }
          });

          if (res.ok) {
            const result = await res.json()
            return {
               success : true,
               data : result
            }
          } else {
            return {success : false, error: 'unknown problem'}
          }
        } catch (err) {
          return {success: false, error: err.message}
        }
    }

    del = async (id: string, conf: IJenIdCheckerConf) => {
        let auth = new Buffer(conf.username + ':' + conf.password);
        let basicAuth = auth.toString('base64');
        try {
          const res = await fetch(API_URL+id, {
             method: 'DELETE',
             headers: {
               'Authorization' : 'Basic '+ basicAuth,
               'Accept' : 'application/json',
             }
          });

          if (res.ok) {
            const result = await res.json()
            return {
               success : true,
               data : result
            }
          } else {
            return {success : false, error: 'unknown problem'}
          }
        } catch (err) {
          return {success: false, error: err.message}
        }
    }

    async sleep(ms: number) {
        await this._sleep(ms);
    }

    _sleep(ms: number) {
        return new Promise((resolve) => setTimeout(resolve, ms));
    }
}

export const name = 'jenIdChecker'

export const createPlugin: CreatePlugin<JenIdCheckerAPI> = ({ bot, applications }, { conf, logger }) => {
  const documentChecker = new JenIdCheckerAPI({ bot, applications, conf, logger })
  const plugin:IPluginLifecycleMethods = {
    onFormsCollected: async ({req}) => {
      if (req.skipChecks) return
      const { user, application, applicant, payload } = req

      if (!application) return

      const formStub = getParsedFormStubs(application).find(form => form.type === PHOTO_ID)
      if (!formStub)
        return

      const form = await bot.getResource(formStub)

debugger
      let toCheck = await doesCheckNeedToBeCreated({bot, type: DOCUMENT_CHECKER_CHECK, application, provider: PROVIDER, form, propertiesToCheck: ['scan'], prop: 'form'})
      if (!toCheck) {
        logger.debug(`${PROVIDER}: check already exists for ${form.firstName} ${form.lastName} ${form.documentType.title}`)
        return
      }
      // debugger
      let status = await documentChecker.handleData(form, application)
      await documentChecker.createCheck({application, status, form})
      if (status.status === 'pass') {
         await documentChecker.createVerification({ application, form, rawData: status.rawData })
      }
    }
  }

  return {
    plugin,
    api: documentChecker
  }


}

export const validateConf:ValidatePluginConf = async (opts) => {
    const pluginConf = opts.pluginConf as IJenIdCheckerConf
    const { username, password, threshold, deleteAfter } = pluginConf

    let err = ''
    if (!password)
      err = '\nExpected "password".'
    else if (typeof password !== 'string')
      err += '\nExpected "password" to be a string.'
    if (!username)
      err += '\nExpected "username"'
    else if (typeof username !== 'string')
      err += '\nExpected "username" to be a string'
    else if (typeof threshold !== 'undefined') {
      if (typeof threshold !== 'number')
         err += '\nExpected threshold to be a number.'
      else if (threshold < 0 || threshold > 100)
         err += '\nExpected  0 <= threshold <= 100.'
    }
    else if (typeof deleteAfter !== 'undefined') {
       if (typeof deleteAfter !== 'boolean')
         err += '\nExpected deleteAfter to be a boolean.'
    }
    if (err.length)
      throw new Error(err)
}
