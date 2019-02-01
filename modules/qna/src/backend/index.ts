import * as sdk from 'botpress/sdk'
import _ from 'lodash'

import api from './api'
import { QnaStorage } from './qna'
import { initBot, initModule } from './setup'

const botScopedStorage: Map<string, QnaStorage> = new Map<string, QnaStorage>()

const onServerStarted = async (bp: typeof sdk) => {
  await initModule(bp, botScopedStorage)
}

const onServerReady = async (bp: typeof sdk) => {
  await api(bp, botScopedStorage)
}

const onBotMount = async (bp: typeof sdk, botId: string) => {
  await initBot(bp, botScopedStorage, botId)
}

const onBotUnmount = async (bp: typeof sdk, botId: string) => {
  botScopedStorage.delete(botId)
}

const onFlowChanged = async (bp: typeof sdk, botId: string, newFlow: sdk.Flow) => {
  const oldFlow = await bp.ghost.forBot(botId).readFileAsObject<sdk.Flow>('./flows', newFlow.location)
  const qnaStorage = await botScopedStorage.get(botId)
  const questions = await qnaStorage.getQuestions({ question: '', categories: [] }, { limit: 0, offset: 0 })

  // Detect nodes that has their name changed
  for (const oldNode of oldFlow.nodes) {
    for (const newNode of newFlow.nodes) {
      if (oldNode.id === newNode.id && oldNode.name !== newNode.name) {
        // Detected
        // Update all questions that refer to the old node name

        const updatedItems = questions.items
          .filter(q => {
            const sameFlow = q.data.redirectFlow === newFlow.name
            const sameNode = q.data.redirectNode === oldNode.name
            return sameFlow && sameNode
          })
          .map(q => {
            q.data.redirectNode = newNode.name
            return q
          })

        for (const q of updatedItems) {
          await qnaStorage.update(q.data, q.id)
          bp.logger.debug(`References to node "${oldNode.name}" has been updated to "${newNode.name}"`)
        }
      }
    }
  }
}

const entryPoint: sdk.ModuleEntryPoint = {
  onServerStarted,
  onServerReady,
  onBotMount,
  onBotUnmount,
  onFlowChanged,
  definition: {
    name: 'qna',
    menuIcon: 'question_answer',
    menuText: 'Q&A',
    fullName: 'QNA',
    homepage: 'https://botpress.io'
  }
}

export default entryPoint
