import { AxiosError } from 'axios'
import { Logger, LoggerEntry, LoggerLevel, LoggerListener, LogLevel } from 'botpress/sdk'
import chalk from 'chalk'
import { Metric } from 'common/monitoring'
import { IDisposable } from 'core/misc/disposable'
import { BotService } from 'core/services/bot-service'
import { incrementMetric } from 'core/services/monitoring'
import { InvalidParameterError } from 'errors'
import { EventEmitter2 } from 'eventemitter2'
import { inject, injectable } from 'inversify'
import _ from 'lodash'
import moment from 'moment'
import os from 'os'
import stripAnsi from 'strip-ansi'
import util from 'util'

import { TYPES } from '../types'

import { LoggerDbPersister, LoggerFilePersister } from '.'

export type LoggerProvider = (module: string) => Promise<Logger>

function serializeArgs(args: any): string {
  if (_.isArray(args)) {
    return args.map(arg => serializeArgs(arg)).join(', ')
  } else if (_.isObject(args)) {
    return util.inspect(args, false, 2, true)
  } else if (_.isString(args)) {
    return args.trim()
  } else if (args && args.toString) {
    return args.toString()
  } else {
    return ''
  }
}

@injectable()
// Suggestion: Would be best to have a CompositeLogger that separates the Console and DB loggers
export class PersistedConsoleLogger implements Logger {
  private botId: string | undefined
  private attachedError: Error | undefined
  public readonly displayLevel: number
  private currentMessageLevel: LogLevel | undefined
  private willPersistMessage: boolean = true
  private emitLogStream = true
  private serverHostname: string = ''

  private static LogStreamEmitter: EventEmitter2 = new EventEmitter2({
    delimiter: '::',
    maxListeners: 1000,
    verboseMemoryLeak: true,
    wildcard: true
  })

  public static listenForAllLogs(fn: LoggerListener, botId: string = '*'): IDisposable {
    if (!_.isFunction(fn)) {
      throw new InvalidParameterError('"fn" listener must be a callback function')
    }

    const namespace = `logs::${botId}`
    this.LogStreamEmitter.on(namespace, fn)
    return { dispose: () => this.LogStreamEmitter.off(namespace, fn) }
  }

  constructor(
    @inject(TYPES.Logger_Name) private name: string,
    @inject(TYPES.LoggerDbPersister) private loggerDbPersister: LoggerDbPersister,
    @inject(TYPES.LoggerFilePersister) private loggerFilePersister: LoggerFilePersister
  ) {
    this.displayLevel = process.VERBOSITY_LEVEL
    this.serverHostname = os.hostname()
  }

  forBot(botId: string): this {
    this.botId = botId
    return this
  }

  attachError(error: Error): this {
    this.attachedError = error
    return this
  }

  persist(shouldPersist: boolean): this {
    this.willPersistMessage = shouldPersist
    return this
  }

  level(level: LogLevel): this {
    this.currentMessageLevel = level
    return this
  }

  noEmit(): this {
    this.emitLogStream = false
    return this
  }

  colors = {
    [LoggerLevel.Info]: 'green',
    [LoggerLevel.Warn]: 'yellow',
    [LoggerLevel.Error]: 'red',
    [LoggerLevel.Critical]: 'red',
    [LoggerLevel.Debug]: 'blue'
  }

  private print(level: LoggerLevel, message: string, metadata: any) {
    if (typeof message !== 'string') {
      metadata = message
      message = '(object)'
    }

    let forceIndentMessage = false
    if (this.attachedError) {
      try {
        const asAxios = this.attachedError as AxiosError
        if (asAxios.response && asAxios.config) {
          forceIndentMessage = true
          message += '\n' + `HTTP (${asAxios.config.method}) URL ${asAxios.config.url}`
          if (asAxios.config.params && Object.keys(asAxios.config.params).length > 0) {
            message += '\n' + `Params (${JSON.stringify(asAxios.config.params)})`
          }
          if (asAxios.response && asAxios.response.data) {
            let errMsg = ''
            if (typeof asAxios.response.data === 'string') {
              errMsg = asAxios.response.data
            } else if (typeof asAxios.response.data === 'object') {
              errMsg = _.at(asAxios.response.data, [
                'error.message',
                'error.description',
                'error.reason',
                'error_message',
                'error_description',
                'error_reason',
                'error',
                'description',
                'message',
                'reason'
              ])
                .filter(Boolean)
                .join('. ')
            }
            if (typeof errMsg === 'string' && errMsg.length) {
              errMsg = errMsg.trim()
              if (errMsg.length >= 100) {
                errMsg = errMsg.substr(0, 100) + ' (...)'
              }
              message += '\n' + `Received "${errMsg}"`
            }
          }
          message += '\n' + this.attachedError.message
        } else {
          message += ` [${this.attachedError.name}, ${this.attachedError.message}]`
        }
      } catch (err) {}
    }

    const serializedMetadata = metadata ? serializeArgs(metadata) : ''
    const timeFormat = 'L HH:mm:ss.SSS'
    const time = moment().format(timeFormat)

    const displayName = process.env.INDENT_LOGS ? this.name.substr(0, 15).padEnd(15, ' ') : this.name
    const newLineIndent = chalk.dim(' '.repeat(`${timeFormat} ${displayName}`.length)) + ' '
    let indentedMessage =
      level === LoggerLevel.Error && !forceIndentMessage ? message : message.replace(/\r\n|\n/g, os.EOL + newLineIndent)

    if (
      this.attachedError &&
      this.displayLevel >= LogLevel.DEV &&
      this.attachedError.stack &&
      this.attachedError['__hideStackTrace'] !== true
    ) {
      indentedMessage += chalk.grey(os.EOL + 'STACK TRACE')
      indentedMessage += chalk.grey(os.EOL + this.attachedError.stack)
    }

    const entry: LoggerEntry = {
      botId: this.botId,
      hostname: this.serverHostname,
      level: level.toString(),
      scope: displayName,
      message: stripAnsi(indentedMessage),
      metadata: stripAnsi(serializedMetadata),
      timestamp: new Date()
    }

    if (this.emitLogStream) {
      PersistedConsoleLogger.LogStreamEmitter.emit(
        `logs::${this.botId || '*'}`,
        level,
        indentedMessage,
        serializedMetadata
      ) // Args => level, message, args
    }

    if (this.willPersistMessage && level !== LoggerLevel.Debug) {
      this.loggerDbPersister.appendLog(entry)
    } else {
      // We reset it right away to prevent race conditions (since the persister might log a new message asynchronously)
      this.willPersistMessage = true
    }

    if (this.displayLevel >= this.currentMessageLevel!) {
      console.log(
        chalk`{grey ${time}} {${this.colors[level]}.bold ${displayName}} ${indentedMessage}${serializedMetadata}`
      )

      this.loggerFilePersister.appendLog(entry)
    }

    this.currentMessageLevel = undefined
    this.botId = undefined
    this.attachedError = undefined
    this.emitLogStream = true
  }

  debug(message: string, metadata?: any): void {
    if (this.currentMessageLevel === undefined) {
      this.currentMessageLevel = LogLevel.DEBUG
    }

    this.print(LoggerLevel.Debug, message, metadata)
  }

  info(message: string, metadata?: any): void {
    if (this.currentMessageLevel === undefined) {
      this.currentMessageLevel = LogLevel.PRODUCTION
    }

    this.print(LoggerLevel.Info, message, metadata)
  }

  warn(message: string, metadata?: any): void {
    if (this.currentMessageLevel === undefined) {
      this.currentMessageLevel = LogLevel.PRODUCTION
    }

    if (this.botId) {
      BotService.incrementBotStats(this.botId, 'warning')
    }

    incrementMetric(Metric.Warnings)
    this.print(LoggerLevel.Warn, message, metadata)
  }

  error(message: string, metadata?: any): void {
    if (this.currentMessageLevel === undefined) {
      this.currentMessageLevel = LogLevel.PRODUCTION
    }

    if (this.botId) {
      BotService.incrementBotStats(this.botId, 'error')
    }

    incrementMetric(Metric.Errors)
    this.print(LoggerLevel.Error, message, metadata)
  }

  critical(message: string, metadata?: any): void {
    if (this.currentMessageLevel === undefined) {
      this.currentMessageLevel = LogLevel.PRODUCTION
    }

    if (this.botId) {
      BotService.incrementBotStats(this.botId, 'critical')
    }

    incrementMetric(Metric.Criticals)
    this.print(LoggerLevel.Critical, message, metadata)
  }
}
