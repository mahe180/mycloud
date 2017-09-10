
# tradle/aws

## Setup

1. Set up AWS credentials in ~/.aws/
2. Install 

```sh
npm run setup
```

The [Serverless Framework](https://github.com/serverless/serverless) is installed as part of `devDependencies`, but you probably also want it installed globally so you can use the serverless cli:

```sh
npm i -g serverless
```

### Local Testing Setup

This project uses [localstack](https://github.com/localstack/localstack) for simulating AWS resources locally (DynamoDB, S3, etc).

Before you can run tests on local resoures, you need to create them:

```sh
# generate the blueprints for our local resources (cloudformation files)
npm run package
# start up localstack
npm run localstack:start
# to stop localstack (and lose your tables and buckets)
#   npm run localstack:stop
# restart localstack (and lose your tables and buckets)
#   npm run localstack:restart
# generate local resources based on cloudformation
npm run gen:localresources
# run tests on local resources
npm run test
# run an end-to-end test, which will creates sample business data in the process
npm run test:e2e
# browse that data via graphql
npm run test:graphqlserver
```

### Deploy

First, make sure Docker is running

```sh
# make sure docker is running
docker ps
# 1. lint & test
# 2. rebuild native modules with AWS Linux container
# 3. deploy to cloud
npm run deploy:safe
```

### Explore

#### List deployed resources, API endpoints, ...

```sh
npm run info

# Service Information
# service: tradle
# stage: dev
# ...
# endpoints:
#  ..
#  ANY - https://example.execute-api.us-east-1.amazonaws.com/dev/tradle/graphql
#  ANY - https://example.execute-api.us-east-1.amazonaws.com/dev/tradle/samples
#  ..
```

#### Generate sample data

If you want to play with the API, you'll first need some data. Let's generate sample data for a single user going through an application for a [Current Account](https://github.com/tradle/custom-models/blob/master/models/tradle.CurrentAccount.json).

```sh
# replace endpoint url with your own
curl -X POST --data '{"users":1,"products":["tradle.CurrentAccount"]}' \
'https://example.execute-api.us-east-1.amazonaws.com/dev/tradle/samples'
```

#### Explore the API

Open GraphiQL and play with the API. Let's create a url with a sample query (because there's an unresolved issue for when no query is passed):

```js
const url = 'https://example.execute-api.us-east-1.amazonaws.com/dev/tradle/graphql?query=' + encodeURIComponent(`{
  rl_tradle_FormRequest {
    edges {
      node {
        _link
      }
    }
  }
}`)

console.log(url)
// https://example.execute-api.us-east-1.amazonaws.com/dev/tradle/graphql?query=%7B%0A%20%20rl_tradle_FormRequest%20%7B%0A%20%20%20%20edges%20%7B%0A%20%20%20%20%20%20node%20%7B%0A%20%20%20%20%20%20%20%20_link%0A%20%20%20%20%20%20%7D%0A%20%20%20%20%7D%0A%20%20%7D%0A%7D
// open in browser
```

#### Logging

You can use the serverless cli:

```sh
sls logs -f bot_graphql --tail
```

Or, for convenience, there's a `tail`-ish script:

```sh
npm run tail -- {function-name} {minutes-ago}
# e.g log the graphql lambda starting 5 minutes ago:
npm run tail -- bot_graphql 5
```

### Destroy

Sometimes you want to wipe the slate clean and start from scratch (usually by age 25 or so). The following command will wipe out all the AWS resources created in your deployment. Obviously, use with EXTREME caution, as this command executes with your AWS credentials (best use a separate account).

```sh
npm run nuke
# a series of y/n prompts ensues, 
# ensuring you're committed to the destruction of all that is holy
```

### Directory Structure

```sh
.              # dev dependencies, serverless framework config
  /cli         # ignore me for now
  /scripts     # various helper scripts
  /project     # code that will be deployed to lambda
    /conf      # various table schemas, used for tests
    /lib
      /bot     # bot engine
    /samplebot # currently co-located sample bot in `./project/samplebot`
```

### Troubleshooting

If you see errors like the one below, it means `localstack` is not up. Launch `localstack` with `npm run localstack:start`

```sh
# Error: connect ECONNREFUSED 127.0.0.1:4569
# ...
```

If tests are failing with errors like the one below, it means you need to generate local resources on `localstack`. Run `npm run gen:localresources`

```sh
# ResourceNotFoundException: Cannot do operations on a non-existent table
# ...
```

If `gen:localresources` fails, you may need to first run `npm run package` to generate the cloudformation files which `gen:localresources` to generate local resources.
