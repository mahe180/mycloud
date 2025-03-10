import _ from 'lodash'
// import validateResource from '@tradle/validate-resource'
import { TYPE, PERMALINK, LINK } from '@tradle/constants'
import DataURI from 'strong-data-uri'
import { getLatestForms, isSubClassOf } from '../utils'
import AWS from 'aws-sdk'
import Embed from '@tradle/embed'
import validateResource from '@tradle/validate-resource'

import PDFJS from 'pdfjs-dist'
import Canvas from '../../canvas'
import assert from 'assert'

// @ts-ignore
const { sanitize } = validateResource.utils

import {
  Bot,
  CreatePlugin,
  ValidatePluginConf,
  Applications,
  IConfComponents,
  IPluginLifecycleMethods,
  Logger
} from '../types'
import Errors from '../../errors'

import Diff from 'text-diff'
import { String } from 'aws-sdk/clients/cognitosync'

const FORM_ID = 'tradle.Form'
const LEGAL_ENTITY = 'tradle.legal.LegalEntity'
const CERTIFICATE_OF_INC = 'tradle.legal.CertificateOfIncorporation'
// export const name = 'document-ocr'

import telcoResponse from '../../../data/in-house-bot/mx-telco-apiResponse'
import energyResponse from '../../../data/in-house-bot/mx-energy-apiResponse'
import { AnyLengthString } from 'aws-sdk/clients/comprehend'
const testMap = {
  'tradle.PhoneBill': telcoResponse,
  'tradle.EnergyBill': energyResponse
}

type DocumentOcrOpts = {
  bot: Bot
  conf: IDocumentOcrConf
  applications: Applications
  logger: Logger
}

interface IDocumentOcrConf {
  [productModelId: string]: {}
}

class NodeCanvasFactory {
  public create(width, height) {
    assert(width > 0 && height > 0, 'Invalid canvas size')
    let canvas = Canvas.createCanvas(width, height)
    // debugger
    let context = canvas.getContext('2d')
    return {
      canvas,
      context
    }
  }

  public reset(canvasAndContext, width, height) {
    assert(canvasAndContext.canvas, 'Canvas is not specified')
    assert(width > 0 && height > 0, 'Invalid canvas size')
    canvasAndContext.canvas.width = width
    canvasAndContext.canvas.height = height
  }

  public destroy(canvasAndContext) {
    assert(canvasAndContext.canvas, 'Canvas is not specified')

    // Zeroing the width and height causes release graphics
    // resources immediately, which can greatly reduce memory consumption.
    canvasAndContext.canvas.width = 0
    canvasAndContext.canvas.height = 0
    canvasAndContext.canvas = null
    canvasAndContext.context = null
  }
}

export class DocumentOcrAPI {
  private bot: Bot
  private conf: IDocumentOcrConf
  private applications: Applications
  private logger: Logger
  constructor({ bot, conf, applications, logger }: DocumentOcrOpts) {
    this.bot = bot
    this.conf = conf
    this.applications = applications
    this.logger = logger
  }
  public async ocr(payload, prop, myConfig) {
    await this.bot.resolveEmbeds(payload)
    // Form now only 1 doc will be processed
    let base64
    if (Array.isArray(payload[prop])) base64 = payload[prop][0].url
    else base64 = payload[prop].url

    let buffer: any = DataURI.decode(base64)

    // debugger
    let imageBuffer = buffer
    if (buffer.mimetype === 'application/pdf') {
      let imagesArray: any[] = await this.extractImagesFromPdf(buffer)
      if (imagesArray.length > 0) imageBuffer = imagesArray[0]
      // first page
      else {
        // TODO maybe it is text pdf and need to processed by pdf2json
        this.logger.error('textract extractImagesFromPdf failed to find images in pdf')
      }
    }

    let accessKeyId = ''
    let secretAccessKey = ''
    let region = 'us-east-1'
    let textract = new AWS.Textract({
      apiVersion: '2018-06-27',
      accessKeyId,
      secretAccessKey,
      region
    })

    let isTest = myConfig.isTest && testMap[payload[TYPE]] !== null

    let params = {
      Document: {
        /* required */
        Bytes: imageBuffer
      }
    }
    try {
      let apiResponse
      if (isTest) apiResponse = testMap[payload[TYPE]]
      else apiResponse = await textract.detectDocumentText(params).promise()
      //  apiResponse has to be json object
      let response: any = this.extractMap(apiResponse, myConfig)

      // need to convert string date into ms -- hack

      let dateProp = getDateProp(myConfig, this.bot.models[payload[TYPE]])
      convertDateInWords(response, dateProp) // response.registrationDate
      return response
    } catch (err) {
      debugger
      this.logger.error('textract detectDocumentText failed', err)
    }
    return {}
  }

  public extractImagesFromPdf = async (pdf): Promise<any[]> => {
    let images = []
    try {
      let doc = await PDFJS.getDocument({
        data: pdf,
        nativeImageDecoderSupport: 'none',
        disableFontFace: true
      }).promise
      let pages = doc.numPages
      for (let i = 1; i <= pages; i++) {
        if (i > 2) break // first 2 pages
        let page = await doc.getPage(i)
        let ops = await page.getOperatorList()
        for (let j = 0; j < ops.fnArray.length; j++) {
          if (
            ops.fnArray[j] == PDFJS.OPS.paintJpegXObject ||
            ops.fnArray[j] == PDFJS.OPS.paintImageXObject
          ) {
            let op = ops.argsArray[j][0]
            let img = page.objs.get(op)
            let scale = img.width / page.view[2]
            let viewport = page.getViewport({ scale })

            let canvasFactory = new NodeCanvasFactory()
            let canvasAndContext = canvasFactory.create(viewport.width, viewport.height)
            let renderContext = {
              canvasContext: canvasAndContext.context,
              viewport,
              canvasFactory
            }
            let renderTask = await page.render(renderContext).promise
            let image = canvasAndContext.canvas.toBuffer()
            images.push(image)
            canvasFactory.destroy(canvasAndContext)
          }
        }
      }
    } catch (err) {
      this.logger.error('textract extractImagesFromPdf failed', err)
    }
    return images
  }

  public sleep = async (ms: number) => {
    await this._sleep(ms)
  }

  public _sleep = (ms: number) => {
    return new Promise(resolve => setTimeout(resolve, ms))
  }

  public lineBlocks = blocks => {
    let lineBlocks = []
    let start = false
    for (let block of blocks) {
      if (block.BlockType == 'PAGE') {
        if (start == false) start = true
        else break
      } else if (block.BlockType == 'LINE') {
        lineBlocks.push(block)
      }
    }
    lineBlocks.sort(this.compare)
    return lineBlocks
  }
  public compare = (block1, block2) => {
    if (block1.Geometry.BoundingBox.Top > block2.Geometry.BoundingBox.Top) return 1
    if (block1.Geometry.BoundingBox.Top == block2.Geometry.BoundingBox.Top) return 0
    return -1
  }

  public match = (template, blocks) => {
    let markerText = template.marker
    let markerBox = template.BoundingBox

    for (let block of blocks) {
      let blockBox = block.Geometry.BoundingBox
      if (blockBox.Top > markerBox.Top + markerBox.Height + 0.05) return false
      //console.log(block.Text)
      if (block.Text === markerText) {
        if (this.isInside(blockBox, markerBox)) {
          return true
        }
      }
    }
  }

  public isInside = (box, bigBox) => {
    return (
      box.Top > bigBox.Top - 0.05 &&
      box.Left > bigBox.Left - 0.05 &&
      box.Width < bigBox.Width + 0.1 &&
      box.Height < bigBox.Height + 0.1
    )
  }

  public fullText = (lines, multiline) => {
    let txt = ''
    let delim = multiline ? '\n' : ' '
    for (let block of lines) {
      txt += block.Text + delim
    }
    return txt
  }

  public extractMap = (apiResponse, myconfig) => {
    let blocks = apiResponse.Blocks
    let lines = this.lineBlocks(blocks)
    for (let template of myconfig.templates) {
      if (this.match(template, lines)) {
        return this.extract(apiResponse, template, lines, myconfig)
      }
    }
    this.logger.debug('marker has not matched')
    return { error: 'Please choose the correct document and try again' } // TODO handle bad/wrong document
  }

  public extract = (apiResponse, template, lines, myconfig) => {
    let input = this.fullText(lines, template.multiline)

    let diff = new Diff()
    let textDiff = diff.main(template.text, input)

    // console.log(textDiff)
    let found = false
    let key
    let map = {}
    for (let part of textDiff) {
      if (part[0] == 0) found = false
      else if (part[0] == -1 && part[1].includes('^')) {
        found = true
        key = part[1]
      } else if (found && part[0] == 1) {
        found = false
        let value = map[key]
        if (value) {
          map[key] = value + '\n' + part[1].trim()
        } else {
          map[key] = part[1].trim()
        }
        this.logger.debug(`${key}  ---> ${map[key]}`)
      }
    }
    let output = {}
    for (const key in map) {
      let value = map[key]
      let newkey = myconfig.map[key]
      if (newkey) output[newkey] = value
    }
    this.logger.debug('in input ' + apiResponse + ' found')
    this.logger.debug(JSON.stringify(output, null, 2))
    return output
  }
}

export const createPlugin: CreatePlugin<void> = ({ bot, applications }, { conf, logger }) => {
  const documentOcrAPI = new DocumentOcrAPI({ bot, conf, applications, logger })
  // debugger
  const plugin: IPluginLifecycleMethods = {
    async onFormsCollected({ req }) {
      const { user, application, payload } = req
      if (!application) return

      const productId = application.requestFor
      const formConf = conf[productId]
      if (!formConf) return
      // debugger
      const latestForms = getLatestForms(application)
      const stub = latestForms.find(form => form.type === LEGAL_ENTITY)
      if (stub) {
        await this.handleLe({ stub, latestForms, req })
        return
      }
      // const piStub = latestForms.find(form => form.type === PERSONAL_INFO)
      // if (piStub) {
      //   debugger
      // }
    },
    async handleLe({ stub, latestForms, req }) {
      let le = await bot.objects.get(stub.link)
      if (le.document) return

      const { user, application, payload } = req

      const certStub = latestForms.find(form => form.type === CERTIFICATE_OF_INC)
      if (!certStub) return
      let cert = await bot.objects.get(certStub.link)

      const { country, companyName, registrationDate, registrationNumber, region } = cert
      // let prefill: any = { [TYPE]: LEGAL_ENTITY }
      if (country && le.country) return

      const { _link, _permalink } = le
      let prefill = _.cloneDeep(le)
      prefill._r = _permalink
      prefill._c = _link
      delete prefill._permalink
      delete prefill._link

      _.extend(prefill, { country, companyName, registrationDate, registrationNumber })
      prefill.document = _.pick(cert, ['_link', '_permalink', '_t'])
      prefill.document._displayName = cert.companyName
      if (region) prefill.region = region
      try {
        prefill = sanitize(prefill).sanitized
      } catch (err) {
        debugger
      }

      let formError: any = {
        req,
        user,
        application,
        details: {
          prefill,
          message: `Please review and confirm`
        }
        // item: payload,
      }
      try {
        await applications.requestEdit(formError)
      } catch (err) {
        debugger
      }
    },
    // async [`onmessage:${FORM_ID}`](req) {
    async validateForm({ req }) {
      const { user, application, payload } = req
      // debugger
      if (!application) return
      const productId = application.requestFor
      const formConf = conf[productId] && conf[productId][payload[TYPE]]
      if (!formConf) return
      const { property } = formConf
      if (!property || !payload[property]) return
      // debugger
      let country = payload.country
      if (!country) return
      let reg = payload.region
      if (reg) {
        if (typeof reg === 'object') reg = reg.id.split('_')[1]
        reg = reg.toLowerCase()
      }
      let confId = `${country.id.split('_')[1].toLowerCase()}${(reg && '_' + reg) || ''}`
      if (!formConf[confId]) return
      // Check if this doc was already processed
      // let dateProp = getDateProp(formConf[confId], bot.models[payload[TYPE]])

      if (payload._prevlink && payload[property]) {
        let dbRes = await bot.objects.get(payload._prevlink)
        let pType = bot.models[payload[TYPE]].properties[property].type
        let isArray = pType === 'array'
        let maybeNotChanged
        if (dbRes) {
          if (isArray)
            maybeNotChanged = dbRes[property] && dbRes[property].length === payload[property].length
          else if (dbRes[property] && dbRes[property].url === payload[property].url) return
        }
        if (maybeNotChanged) {
          let dbPhotos = dbRes[property]
          let payloadPhotos = payload[property]
          let same = true
          for (let i = 0; i < dbPhotos.length && same; i++) {
            let url = dbPhotos[i].url
            let idx = payloadPhotos.findIndex(r => r.url === url)
            same = idx !== -1
          }
          if (same) return
        }
      }
      let prefill
      try {
        prefill = await documentOcrAPI.ocr(payload, property, formConf[confId])
        if (prefill.error) {
          return {
            message: prefill.error
          }
        }
        prefill = sanitize(prefill).sanitized
      } catch (err) {
        debugger
        return
      }
      const payloadClone = _.cloneDeep(payload)
      payloadClone[PERMALINK] = payloadClone._permalink
      payloadClone[LINK] = payloadClone._link

      _.extend(payloadClone, prefill)
      // debugger
      let formError: any = {
        req,
        user,
        application
        // item: payload,
      }
      // if (prefill) {
      formError.details = {
        prefill: payloadClone,
        message: `Please review and correct the data below`
      }
      // }
      // else {
      //   formError.details = {
      //     message: `Please fill out the form`
      //   }
      // }
      try {
        await applications.requestEdit(formError)
        return {
          message: 'no request edit',
          exit: true
        }
      } catch (err) {
        debugger
      }
    }
  }

  return { plugin }
}
export const validateConf: ValidatePluginConf = async ({
  bot,
  conf,
  pluginConf
}: {
  bot: Bot
  conf: IConfComponents
  pluginConf: IDocumentOcrConf
}) => {
  const { models } = bot
  Object.keys(pluginConf).forEach(productModelId => {
    const productModel = models[productModelId]
    if (!productModel) {
      throw new Errors.InvalidInput(`model not found: ${productModelId}`)
    }

    if (productModel.subClassOf !== 'tradle.FinancialProduct') {
      throw new Errors.InvalidInput(`expected a product model: ${productModelId}`)
    }

    const forms = pluginConf[productModelId]

    for (let formModelId in forms) {
      const formModel = models[formModelId]
      if (!formModel) {
        throw new Errors.InvalidInput(`model not found: ${formModelId}`)
      }

      if (
        !isSubClassOf('tradle.Form', formModel, bot.models) &&
        formModel.subClassOf !== 'tradle.MyProduct'
      ) {
        throw new Errors.InvalidInput(
          `expected ${productModelId} to map to subclasses of tradle.Form or tradle.MyProduct`
        )
      }
      const prop = forms[formModelId].property
      if (!formModel.properties[prop]) {
        throw new Errors.InvalidInput(`property ${prop} was not found in ${formModelId}`)
      }
    }
  })
}
// let input = {"companyName":"TRADLE, INC.",
//              "registrationDate_DAY":"TWENTY-NINTH",
// "registrationDate_MONTH":"APRIL",
// "registrationDate_YEAR":"2014",
// "registrationNumber":"5524712"}

function daytonum(day) {
  const daymap = {
    first: '01',
    second: '02',
    third: '03',
    fourth: '04',
    fifth: '05',
    sixth: '06',
    seventh: '07',
    eighth: '08',
    ninth: '09',
    tenth: '10',
    eleventh: '11',
    twelfth: '12',
    thirteenth: '13',
    fourteenth: '14',
    fifteenth: '15',
    sixteenth: '16',
    seventeenth: '17',
    eighteenth: '18',
    nineteenth: '19',
    twentieth: '20',
    'twenty-first': '21',
    'twenty-second': '22',
    'twenty-third': '23',
    'twenty-fourth': '24',
    'twenty-fifth': '25',
    'twenty-sixth': '26',
    'twenty-seventh': '27',
    'twenty-eighth': '28',
    'twenty-ninth': '29',
    thirtieth: '30',
    'thirty-first': '31'
  }
  return daymap[day.toLowerCase()]
}

function monthtonum(month) {
  const monthmap = {
    january: '01',
    february: '02',
    march: '03',
    april: '04',
    may: '05',
    june: '06',
    july: '07',
    august: '08',
    september: '09',
    october: '10',
    november: '11',
    december: '12'
  }
  return monthmap[month.toLowerCase()]
}

function convertDateInWords(input, dateProp) {
  if (dateProp == 'billDate') {
    let day = dateProp + '_day'
    let mon = dateProp + '_month'
    let year = dateProp + '_year'
    // HACK for now
    if (input[mon] === 'ABR') input[mon] = 'APR'
    if (input[day] && input[mon] && input[year]) {
      let date = input[day] + ' ' + input[mon] + ' ' + input[year]
      let d = Date.parse(date)
      input[dateProp] = d
    }
    delete input[year]
    delete input[mon]
    delete input[day]
  } else {
    let date = dateProp + '_special'
    if (input[date]) {
      // let matches = input[date].match(/([\w-?]+) DAY OF (\w+), A.D. (\d+), (.+)/i)
      let matches = input[date].match(/([\w-?]+) DAY OF (\w+), A. ?D. (\d+), (.+)/i)
      if (matches && matches.length > 4) {
        let d = Date.parse(matches[3] + '-' + monthtonum(matches[2]) + '-' + daytonum(matches[1]))
        input[dateProp] = d
      }
      delete input[date]
    } else if (input[dateProp]) {
      let d = Date.parse(input[dateProp])
      input[dateProp] = d
    }
  }
}
function getDateProp(myConfig, model) {
  let map: any = Object.values(myConfig.map)
  let dateProp = map.find(p => p.toLowerCase().indexOf('_') !== -1)
  if (dateProp) return dateProp.split('_')[0]
  const mProps = model.properties
  return map.find(p => mProps[p].type === 'date')
}

// convertDateInWords(input)
// console.log(input)
