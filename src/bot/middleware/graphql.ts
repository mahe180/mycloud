// import Router = require('koa-router')
// @ts-ignore
import Promise = require('bluebird')
import compose = require('koa-compose')
import graphqlHTTP = require('koa-graphql')
import { formatError } from 'graphql'
import ModelsPack = require('@tradle/models-pack')
import { Level } from '../../logger'
import { logResponseBody } from '../../utils'
import { getGraphqlAPI, prettifyQuery } from '../graphql'

export const createHandler = (opts) => {
  const { bot, logger } = opts

  // allow models to be set asynchronously

  // let auth
  let graphiqlOptions = {}
  let api
  let modelsVersionId:string
  const { modelStore } = bot

  const updateVersionId = (models) => {
    modelsVersionId = ModelsPack.versionId(models)
  }

  bot.promiseReady().then(() => {
    api = getGraphqlAPI(opts)
  })

  if (modelStore.models) updateVersionId(modelStore.models)

  modelStore.on('update', updateVersionId)

  const handler = graphqlHTTP(async (req) => {
    logger.debug(`hit graphql query route, ready: ${bot.isReady()}`)
    await bot.promiseReady()
    const { query, variables } = req.body
    if (query && query.indexOf('query IntrospectionQuery') === -1) {
      logger.debug('received query:')
      logger.debug(prettifyQuery(req.body.query))
    }

    if (variables && variables.modelsVersionId) {
      if (modelsVersionId !== variables.modelsVersionId) {
        throw new Error(`expected models with versionId: ${modelsVersionId}`)
      }
    }

    return {
      get schema() { return api.schema },
      graphiql: graphiqlOptions,
      formatError: err => {
        console.error('experienced error executing GraphQL query', err.stack)
        return formatError(err)
      }
    }
  })

  const middleware = [
    handler
  ]

  if (logger.level >= Level.SILLY) {
    middleware.push(logResponseBody(logger))
  }

  // router.setGraphQLAuth = authImpl => auth = authImpl
  // router.use(cors())
  // router.use(bodyParser({ jsonLimit: '10mb' }))

  // router.use('/graphql', async (ctx, next) => {
  //   logger.debug(`hit graphql auth route, ready: ${bot.isReady()}`)
  //   await bot.promiseReady()
  //   if (auth) {
  //     await auth(ctx, next)
  //   } else {
  //     await next()
  //   }
  // })


  const stack = compose(middleware)
  stack.setGraphiqlOptions = options => graphiqlOptions = options
  stack.getGraphqlAPI = () => getGraphqlAPI(opts)
  return stack
}
