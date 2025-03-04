import 'bluebird-global'
import * as sdk from 'botpress/sdk'
import _ from 'lodash'

import api from './api'
import Database from './db'
import setup from './setup'

let db: Database

const interactionsToTrack = ['message', 'text', 'button', 'template', 'quick_reply', 'postback']

const onServerStarted = async (bp: typeof sdk) => {
  db = new Database(bp)
  await setup(bp, db, interactionsToTrack)
}

const onServerReady = async (bp: typeof sdk) => {
  await api(bp, db)
}

const onModuleUnmount = async (bp: typeof sdk) => {
  bp.events.removeMiddleware('analytics.incoming')
  bp.events.removeMiddleware('analytics.outgoing')
  bp.http.deleteRouterForBot('analytics')
}

const entryPoint: sdk.ModuleEntryPoint = {
  onServerStarted,
  onServerReady,
  onModuleUnmount,
  definition: {
    name: 'analytics',
    fullName: 'Analytics',
    homepage: 'https://botpress.com',
    menuIcon: 'timeline',
    menuText: 'Analytics'
  }
}

export default entryPoint
