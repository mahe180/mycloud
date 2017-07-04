
module.exports = namespace => {
  const DEPLOYMENT = `${namespace}.Deployment`
  const CONFIGURATION = `${namespace}.Configuration`
  const PRODUCT_DEF = `${namespace}.ProductDefinition`
  return {
    [DEPLOYMENT]: {
      type: 'tradle.Model',
      title: 'Tradle in AWS',
      id: DEPLOYMENT,
      interfaces: ['tradle.Message'],
      subClassOf: 'tradle.FinancialProduct',
      forms: [
        `${namespace}.Configuration`
      ],
      properties: {
        scale: {
          type: 'number'
        }
      }
    },
    [CONFIGURATION]: {
      type: 'tradle.Model',
      title: 'AWS Configuration',
      id: CONFIGURATION,
      interfaces: ['tradle.Message'],
      subClassOf: 'tradle.Form',
      properties: {
        name: {
          type: 'string',
          description: 'the name of your organization'
        },
        scale: {
          type: 'number',
          description: 'in millions of customers, e.g. 100 means 100M customers'
        },
        domain: {
          type: 'string',
          description: 'top level domain you own'
        },
        // subdomain: {
        //   type: 'string',
        //   pattern: /[a-zA-Z]/,
        //   description: 'subdomain at which to place the Tradle cloud public endpoints'
        // }
      }
    },
    [PRODUCT_DEF]: {
      type: 'tradle.Model',
      title: 'Product Definition',
      id: PRODUCT_DEF,
      interfaces: ['tradle.Message'],
      subClassOf: 'tradle.Form',
      properties: {
        name: {
          type: 'string',
          description: 'the name of your product'
        },
        // forms: {
        //   type: 'array',
        //   ref: 'tradle.Form',
        //   description: 'the forms required in your product'
        // }
      }
    }
  }
}
