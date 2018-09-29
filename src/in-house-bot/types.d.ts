import { Context as KoaContext } from 'koa'
import { Middleware as ComposeMiddleware } from 'koa-compose'
import { Bot, ModelsPack, DatedValue, Lambda, BaseLambda, IUser } from '../types'
import { Conf } from './configure'
import { Commander } from './commander'
import { Onfido } from './plugins/onfido'
import { Remediation } from './remediation'
import { Deployment } from './deployment'
import { Alerts } from './alerts'
import { Applications } from './applications'
import { Friends } from './friends'
import { EmailBasedVerifier } from './email-based-verifier'
import { DocumentCheckerAPI } from './plugins/documentChecker'
import {
  ITradleObject,
  IIdentity,
  ITradleMessage,
  ResourceStub,
  Logger,
  ILambdaOpts,
  IDeepLink,
  ILambdaExecutionContext,
  SNSEvent,
  EnumValueStub,
  VersionInfo,
  Registry,
  ILambdaContextComponents,
} from '../types'

export * from '../types'

export {
  Conf,
  Commander,
  Onfido,
  Friends,
  Applications,
  Remediation,
  Deployment,
  EmailBasedVerifier
}

export type StringToNumMap = {
  [key: string]: number
}

export interface IProductsConf {
  enabled: string[]
  autoApprove?: boolean
  approveAllEmployees?: boolean
  maximumApplications?: StringToNumMap
  plugins?: any
}

export interface ITours {
  [name:string]: ITradleObject
}

export interface KVMap {
  [key: string]: any
}

export interface ILoggingConf {
  senderEmail: string
  destinationEmails: string[]
}

export interface IBotConf {
  products: IProductsConf
  tours?: ITours
  sandbox?: boolean
  graphqlAuth?: boolean
  credentials?: KVMap
  logging?: ILoggingConf
  // exposed directly in /info
  // publicConfig: any
}

type StringToStringMap = {
  [x: string]: string
}

interface KYCServiceDiscoveryMap {
  [serviceName: string]: {
    enabled: boolean
    path: string
  }
}

export interface KYCServiceDiscovery {
  apiUrl: string
  apiKey?: string
  services: KYCServiceDiscoveryMap
}

export interface IConfComponents {
  bot: IBotConf
  org: IOrganization
  modelsPack?: ModelsPack
  style?: any
  termsAndConditions?: DatedValue
  kycServiceDiscovery?: KYCServiceDiscovery
}

export interface IBotComponents extends ILambdaContextComponents {
  bot: Bot
  logger: Logger
  productsAPI: any
  employeeManager: any
  applications: Applications
  friends: Friends
  alerts: Alerts
  conf?: IConfComponents
  remediation?: Remediation
  onfido?: Onfido
  deployment?: Deployment
  commands?: Commander
  emailBasedVerifier?: EmailBasedVerifier
  documentChecker?: DocumentCheckerAPI
  [x:string]: any
}

export type CliOpts = {
  remote?: boolean
  console?: any
}

export interface IYargs {
  _: string[]
  [x: string]: any
}

export interface IPBUser extends IUser {
  friend?: ResourceStub
  identity?: ResourceStub
  applications?: IPBAppStub[]
  applicationsApproved?: IPBAppStub[]
  applicationsDenied?: IPBAppStub[]
}

export interface IPBReq {
  user: IPBUser
  message: ITradleMessage
  payload: ITradleObject
  // alias for "payload"
  object: ITradleObject
  type: string
  context?: string
  application?: IPBApp
  draftApplication?: IPBAppDraft
  applicant?: IPBUser
  isFromEmployee?: boolean
  skipChecks?: boolean
}

export type VerifiedItem = {
  item: ResourceStub
  verification: ResourceStub
}

export type ApplicationSubmission = {
  application: ResourceStub
  submission: ResourceStub
}

export interface IPBApp extends ITradleObject {
  applicant: ResourceStub
  request?: ResourceStub
  requestFor: string
  context: string
  forms?: ApplicationSubmission[]
  verifications?: ApplicationSubmission[]
  relationshipManagers?: ResourceStub[]
  checks?: ResourceStub[]
  status: string
  dateStarted: number
  dateModified: number
  dateCompleted?: number
  draft?: boolean
}

export interface IPBAppDraft extends ITradleObject {
  applicant: ResourceStub
  request?: ResourceStub
  requestFor: string
  dateStarted?: number
  dateModified?: number
  dateCompleted?: number
}

export interface IPBAppStub {
  dateModified: number
  requestFor: string
  statePermalink: string
  context: string
  status: string
}

export interface IFormRequest extends ITradleObject {
  form: string
  prefill?: any
}

export interface IWillRequestFormArg {
  user: IPBUser
  application?: IPBApp
  formRequest: IFormRequest
}

export interface IOnFormsCollectedArg {
  req: IPBReq
  user: IPBUser
  application: IPBApp
}

// deprecated
export interface ICommandInput {
  command: string
  req?: IPBReq
  sudo?: boolean
  confirmed?: boolean
}

export interface ICommandParams {
  component: keyof IBotComponents
  method: string
  params: any
}

export interface ICommandOutput1 {
  command?: ICommandParams
  result?: any
  error?: any
  extra?: any
}

export interface IDeferredCommandParams {
  command: ICommandParams
  ttl?: number
  dateExpires?: number
  extra?: any
}

export interface ICommandContext {
  commander: Commander
  commandName: string
  commandString: string
  argsStr: string
  req?: IPBReq
  args?: IYargs
  employee?: boolean
  sudo?: boolean
  confirmed?: boolean
  [x:string]: any
}

export interface ICommandOutput {
  ctx: ICommandContext
  command?: ICommand
  result?:any
  error?:any
}

// export interface IDeferredCommandOutput extends ICommandOutput {
//   extra?: any
// }

export interface ICommandSendResultOpts extends ICommandContext {
  to: IPBUser | string
  result: any
}

export interface ICommand {
  name: string
  description: string
  examples: string[]
  exec: (opts:ICommandContext) => Promise<any>
  parse?: (args:string, opts?:any) => any
  parseOpts?: any
  sendResult?: (opts:ICommandSendResultOpts) => Promise<any>
  aliases?: string[]
  adminOnly?: boolean
}

export type Name = {
  firstName:string
  lastName:string
  formatted?:string
}

interface IOnPendingApplicationCollisionArg {
  req: IPBReq
  pending: ResourceStub[]
}

interface IGetRequiredFormsArg {
  user: IPBUser
  application: IPBApp
  productModel: any
}

export interface IPluginLifecycleMethods {
  onmessage?: (req:IPBReq) => boolean|void | Promise<boolean|void>
  willRequestForm?: (opts:IWillRequestFormArg) => void | Promise<void>
  onFormsCollected?: (opts:IOnFormsCollectedArg) => void | Promise<void>
  onPendingApplicationCollision?: (opts:IOnPendingApplicationCollisionArg) => void | Promise<void>
  onRequestForExistingProduct?: (req:IPBReq) => void | Promise<void>
  onCommand?: ({ req: IPBReq, command: string }) => void | Promise<void>
  getRequiredForms?: (opts: IGetRequiredFormsArg) => Promise<void|string[]>
  [toBeDefined: string]: any
}

export interface IPluginExports<BotComponent> {
  plugin: IPluginLifecycleMethods
  api?: BotComponent
  [customExport: string]: any
}

export interface IPluginOpts {
  logger: Logger
  conf?: any
}

export type CreatePlugin<BotComponent> = (components:IBotComponents, opts:IPluginOpts) => IPluginExports<BotComponent>

export type ValidatePluginConfOpts = {
  bot: Bot
  conf: IConfComponents
  pluginConf: any
  [other:string]: any
}

export type UpdatePluginConfOpts = ValidatePluginConfOpts

export type ValidatePluginConf = (opts:ValidatePluginConfOpts) => Promise<void>
export type UpdatePluginConf = (opts:UpdatePluginConfOpts) => Promise<void>
export interface IPlugin<BotComponent> {
  name?: string
  createPlugin: CreatePlugin<BotComponent>
  validateConf?: ValidatePluginConf
  updateConf?: UpdatePluginConf
}

export type IPlugins = Registry<IPlugin<any>>

export type ClaimType = 'bulk' | 'prefill'

export type ClaimStub = {
  key: string
  nonce: string
  claimType: ClaimType
  claimId: string
  qrData?: string
}

export interface IDataBundle extends ITradleObject {
  items: ITradleObject[]
}

export interface IDeploymentConf extends ITradleObject {
  name: string
  domain: string
  logo?: string
  stackPrefix: string
  region: string
  adminEmail?: string
  // configurationLink?: string
}

// conf used by MyCloud for initialization
export interface IOrganization extends ITradleObject {
  name: string
  domain: string
}

export interface MiniVersionInfo extends Partial<VersionInfo> {
  tag: string
  commit: string
}

export interface ICallHomePayload {
  org: IOrganization
  identity: IIdentity
  deploymentUUID: string
  apiUrl: string
  stackId: string
  version: MiniVersionInfo
  adminEmail: string
  logo?: string
}

export interface IMyDeploymentConf {
  // become "org"
  name: string
  domain: string
  // same as ICallHomePayload
  identity: IIdentity
  deploymentUUID: string
  apiUrl: string
  service: string
  stage: string
  stackName: string
  stackId: string
  referrerUrl: string
  logo?: string
}

export interface StackDeploymentInfo {
  identity?: IIdentity
  org?: IOrganization
  referrerUrl?: string
  deploymentUUID?: string
  adminEmail?: string
}

export interface CallHomeOpts extends StackDeploymentInfo {

}

export interface IDeploymentConfForm extends ITradleObject {
  adminEmail: string
  hrEmail: string
}

export interface IPBotLambdaOpts extends ILambdaOpts<IPBMiddlewareContext> {
  event: string
  preware?: IPBMiddleware
  [x:string]: any
}

interface IDeploymentReplicationRegionConf {
  region: string
  bucket: string
  createIfNotExists?: boolean
}

export interface IDeploymentReplicationConf {
  regions: string[]
  // regions: IDeploymentReplicationRegionConf[]
}

export interface IDeploymentPluginConf {
  senderEmail?: string
  stackStatusNotificationsEmail?: string
  replication?: IDeploymentReplicationConf
}

export interface IApplyForProductDeepLink extends IDeepLink {
  product: string
  contextId?: string
}

export interface IImportDataDeepLink extends IDeepLink {
  dataHash: string
}

export interface IPBMiddlewareContext extends ILambdaExecutionContext {
  components: IBotComponents
}

export interface IPBHttpMiddlewareContext extends IPBMiddlewareContext, KoaContext {
  body: any
}

export interface IPBSNSMiddlewareContext extends IPBMiddlewareContext {
  event: SNSEvent
}

export type IPBMiddleware = ComposeMiddleware<IPBMiddlewareContext>

export interface IAppLinkSet {
  mobile?: string
  web?: string
  employeeOnboarding?: string
}

export interface ITradleCheck extends ITradleObject {
  aspects: string|string[]
  status: EnumValueStub
}

export type IPBLambda = BaseLambda<IPBMiddlewareContext>
export type IPBLambdaHttp = BaseLambda<IPBHttpMiddlewareContext>
export type IPBLambdaSNS = BaseLambda<IPBSNSMiddlewareContext>
