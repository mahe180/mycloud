import { ICommand } from '../../../types'

export const command:ICommand = {
  name: 'listproducts',
  examples: [
    '/listproducts'
  ],
  aliases: [
    '/lsproducts',
    '/ls-products'
  ],
  description: 'see a list of products',
  exec: async ({ commander, req }) => {
    return commander.conf.bot.products.enabled.slice()
      .map(id => {
        const model = commander.bot.modelStore.models[id]
        const title = model ? model.title : ''
        return { id, title }
      })
  },
  sendResult: async ({ commander, req, result }) => {
    if (commander.employeeManager.isEmployee(req.user)) {
      const enabled = result
        .map(({ id, title }) => `${title} (${id})`)
        .join('\n')

      const message = `enabled products:\n\n${enabled}`
      await commander.sendSimpleMessage({ req, message })
    } else {
      await commander.productsAPI.sendProductList({ to: req.user })
    }
  }
}
