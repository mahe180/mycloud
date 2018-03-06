require('./env').install()

import test from 'tape'
import _ from 'lodash'
import sinon from 'sinon'
import { TYPE, SIG, PREVLINK, PERMALINK } from '@tradle/constants'
import buildResource from '@tradle/build-resource'
import models from '../models'
import { Backlinks } from '../backlinks'
import Errors from '../errors'
import { loudAsync, setVirtual, parseId } from '../utils'
import { IIdentity } from '../types'
import { createTestTradle } from '../'

test('update backlink', loudAsync(async (t) => {
  const sandbox = sinon.createSandbox()
  const permalink = 'abc'
  const link = 'efg'
  const type = 'tradle.PhotoID'
  const id = buildResource.id({ type, permalink, link })
  const { kv, modelStore } = createTestTradle()
  const store = kv.sub('bltest:')
  const backlinks = new Backlinks({ store, modelStore })
  const expectedBacklinkValue = []
  let lastBacklinkValue
  const backlinkKey = `${type}_${permalink}.verifications`
  const getStub = sandbox.stub(store, 'get').callsFake(async (key) => {
    if (key === backlinkKey && lastBacklinkValue) {
      return _.cloneDeep(lastBacklinkValue)
    }

    throw new Errors.NotFound(key)
  })

  const putStub = sandbox.stub(store, 'put').callsFake(async (key, value) => {
    t.equal(key, backlinkKey)
    t.same(value, expectedBacklinkValue)
    lastBacklinkValue = value
  })

  const verification = {
    [TYPE]: 'tradle.Verification',
    [SIG]: 'sig1',
    document: { id }
  }

  expectedBacklinkValue[0] = buildResource.id({ models, resource: verification })
  // put 1
  await backlinks.updateBacklinks(verification)
  // shouldn't change
  await backlinks.updateBacklinks(verification)

  // version 2 of verification
  const verification2 = _.extend({}, verification, {
    [PREVLINK]: buildResource.link(verification),
    [PERMALINK]: buildResource.permalink(verification),
    [SIG]: 'sig2'
  })

  expectedBacklinkValue[0] = buildResource.id({ models, resource: verification2 })

  // put 2
  await backlinks.updateBacklinks(verification2)

  const verification3 = _.extend({}, verification, {
    [SIG]: 'sig3'
  })

  expectedBacklinkValue.push(buildResource.id({
    resource: verification3,
    models
  }))

  // put 3
  await backlinks.updateBacklinks(verification3)

  t.equal(putStub.callCount, 3)
  sandbox.restore()
  t.end()
}))
