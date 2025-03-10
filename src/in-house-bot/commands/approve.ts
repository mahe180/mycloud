import parse from 'yargs-parser'
import { ICommand } from '../types'

export const command:ICommand = {
  name: 'approve',
  description: 'approve an application',
  examples: [
    '/approve <application permalink>'
  ],
  parse: (argsStr:string) => {
    return {
      application: parse(argsStr)._[0]
    }
  },
  exec: async ({ commander, req, ctx, args }) => {
    await commander.applications.approve({ req, application: args.application })
  },
  sendResult: async ({ commander, req, to }) => {
    // TODO: link to application
    await commander.sendSimpleMessage({ req, to, message: 'application approved!' })
  }
}
