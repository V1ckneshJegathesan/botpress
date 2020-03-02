import { Button, Dialog, FormGroup, HTMLSelect, Label, MenuItem, NonIdealState } from '@blueprintjs/core'
import { ItemRenderer, Select } from '@blueprintjs/select'
import axios from 'axios'
import { ActionDefinition, ActionParameterDefinition, ActionServer, ActionServerWithActions } from 'common/typings'
import _ from 'lodash'
import React, { FC, useEffect, useState } from 'react'

import { Action, Parameters } from '../diagram/nodes_v2/ActionNode'

import style from './style.scss'
import { ActionParameters } from './ActionParameters'

export interface ParameterValue {
  definition: ActionParameterDefinition
  value: string
}

const ActionNameSelect: FC<{
  name: string
  actions: ActionDefinition[]
  onUpdate: (name: string) => void
}> = props => {
  const { name, actions, onUpdate } = props
  const ActionSelect = Select.ofType<ActionDefinition>()

  const ActionItemRenderer: ItemRenderer<ActionDefinition> = (item, { handleClick }) => {
    return (
      <div key={item.name} onClick={handleClick} className={style.actionSelectItem}>
        <div>
          <span className={style.category}>{item.category}</span> - {item.name}
        </div>
        <div className={style.description}>{item.description}</div>
      </div>
    )
  }

  return (
    <>
      <FormGroup
        helperText="This is the action that will be executed on the chosen Action Server"
        label="Action"
        labelFor="action-name"
      >
        <ActionSelect
          items={actions}
          itemRenderer={ActionItemRenderer}
          onItemSelect={item => {
            onUpdate(item.name)
          }}
          filterable={false}
        >
          <Button text={name} rightIcon="double-caret-vertical" />
        </ActionSelect>
      </FormGroup>
    </>
  )
}

const ActionParametersComponent: FC<{
  actionDefinitionParams: ActionParameterDefinition[]
  actionParams: Parameters
  onUpdate: (params: Parameters) => void
}> = props => {
  const { actionDefinitionParams, actionParams, onUpdate } = props
  return (
    <FormGroup
      label="Action Parameters"
      labelFor="action-parameters"
      helperText={actionDefinitionParams.length === 0 ? 'This action has no parameters' : undefined}
    >
      <ActionParameters
        parameterValues={actionDefinitionParams.map(parameterDefinition => {
          return { definition: parameterDefinition, value: actionParams[parameterDefinition.name] || '' }
        })}
        onUpdate={parameterValues => {
          const paramsObj = parameterValues.reduce((previousValue, parameterValue) => {
            previousValue[parameterValue.definition.name] = parameterValue.value
            return previousValue
          }, {})

          onUpdate(paramsObj)
        }}
      />
    </FormGroup>
  )
}

const ActionServers: FC<{
  actionServerId: string
  actionServers: ActionServer[]
  onUpdate: (actionServerId: string) => void
}> = props => {
  const { actionServerId, actionServers, onUpdate } = props
  return (
    <FormGroup label="Action Server" helperText="This is the Action Server on which the action will be executed">
      <HTMLSelect
        value={actionServerId}
        onChange={e => {
          e.preventDefault()
          onUpdate(e.target.value)
        }}
      >
        {actionServers.map(actionServer => (
          <option key={actionServer.id} value={actionServer.id}>
            {actionServer.id} ({actionServer.baseUrl})
          </option>
        ))}
      </HTMLSelect>
    </FormGroup>
  )
}

const ActionDialog: FC<{
  name: string
  parameters: Parameters
  actionServerId: string
  isOpen: boolean
  onClose: () => void
  onSave: (action: Action) => void
}> = props => {
  const { isOpen, onClose, onSave } = props

  const [actionServers, setActionServers] = useState<ActionServerWithActions[]>([])
  const [name, setName] = useState(props.name)
  const [parameters, setParameters] = useState(props.parameters)
  const [actionServerId, setActionServerId] = useState(props.actionServerId)
  const [opening, setOpening] = useState(false)
  const [errorFetchingServers, setErrorFetchingServers] = useState(false)

  useEffect(() => {
    const fetchActionServers = async () => {
      try {
        const response = await axios.get(`${window.BOT_API_PATH}/actionServers`)
        setActionServers(response.data)
        setErrorFetchingServers(false)
      } catch (e) {
        setErrorFetchingServers(true)
      }
    }

    if (opening) {
      // tslint:disable-next-line: no-floating-promises
      fetchActionServers()
    }
  }, [opening])

  const currentActionServer: ActionServerWithActions | undefined =
    actionServers.find(s => s.id === actionServerId) || actionServers[0]
  if (actionServerId === '' && currentActionServer) {
    setActionServerId(currentActionServer.id)
  }
  const currentActionServerHasActions = currentActionServer?.actions && currentActionServer.actions.length > 0
  let currentActionDefinition: ActionDefinition | undefined
  if (currentActionServerHasActions) {
    currentActionDefinition = currentActionServer.actions.find(a => a.name === name) || currentActionServer.actions[0]
    if (name === '' && currentActionDefinition) {
      setName(currentActionDefinition.name)
    }
  }

  const isActionValid = !!name && !!actionServerId && !errorFetchingServers

  return (
    <Dialog
      isOpen={isOpen}
      title="Edit Action"
      icon="offline"
      onClose={() => {
        setOpening(false)
        setName(props.name)
        setParameters(props.parameters)
        setActionServerId(props.actionServerId)
        onClose()
      }}
      onOpening={() => setOpening(true)}
    >
      <div
        className={style.actionDialogContent}
        onMouseDown={e => {
          // TODO: check for a more elegant way to stop event propagation
          e.stopPropagation()
        }}
        onContextMenu={e => {
          // TODO: check for a more elegant way to stop event propagation
          e.stopPropagation()
        }}
      >
        {errorFetchingServers && (
          <NonIdealState
            title="Could not retrieve Action Servers"
            description="There seems to be an error in your Botpress server. Please contact your administrator."
            icon="warning-sign"
          />
        )}
        {!errorFetchingServers && (
          <ActionServers
            actionServers={actionServers}
            actionServerId={actionServerId}
            onUpdate={actionServerId => {
              setActionServerId(actionServerId)
              const actionServer = actionServers.find(s => s.id === actionServerId)
              setName(actionServer.actions[0]?.name || '')
            }}
          />
        )}

        {!currentActionServerHasActions && (
          <NonIdealState
            title="Could not retrieve actions for current Action Server"
            description="There seems to be an error in your Botpress server. Please contact your administrator."
            icon="warning-sign"
          />
        )}

        {currentActionServer && currentActionDefinition && (
          <ActionNameSelect
            actions={currentActionServer.actions}
            name={currentActionDefinition.name}
            onUpdate={name => {
              setName(name)
            }}
          />
        )}

        {currentActionDefinition && (
          <ActionParametersComponent
            actionDefinitionParams={currentActionDefinition.params}
            actionParams={parameters}
            onUpdate={parameters => setParameters(parameters)}
          />
        )}

        {currentActionServer?.actions?.length === 0 && (
          <NonIdealState icon="warning-sign" title="No actions found on this Action Server" />
        )}

        <Button
          onClick={() => {
            onSave({ name, actionServerId, parameters })
          }}
          disabled={!isActionValid}
        >
          Save
        </Button>
      </div>
    </Dialog>
  )
}

export default ActionDialog
