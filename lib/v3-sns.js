/*
 * Copyright 2021 New Relic Corporation. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

'use strict'

module.exports = function instrument(shim, name, resolvedName) {
  const fileNameIndex = resolvedName.indexOf('/index')
  const relativeFolder = resolvedName.substr(0, fileNameIndex)

  // The path changes depending on the version... so we don't want to hard-code the relative
  // path from the module root.
  const snsClientExport = shim.require(`${relativeFolder}/SNSClient`)

  if (!shim.isFunction(snsClientExport.SNSClient)) {
    shim.logger.debug('Could not find SNSClient, not instrumenting.')
    return
  }

  shim.setLibrary(shim.SNS)
  shim.wrapReturn(
    snsClientExport,
    'SNSClient',
    function wrappedReturn(shim, original, fnName, instance) {
      postClientConstructor.call(instance, shim)
    }
  )
}

/**
 * Calls the instances middlewareStack.use to register
 * a plugin that adds a middleware to record the time it teakes to publish a message
 * see: https://aws.amazon.com/blogs/developer/middleware-stack-modular-aws-sdk-js/
 *
 * @param {Shim} shim
 */
function postClientConstructor(shim) {
  this.middlewareStack.use(getPlugin(shim))
}

/**
 * Returns the plugin object that adds middleware
 *
 * @param {Shim} shim
 * @returns {object}
 */
function getPlugin(shim) {
  return {
    applyToStack: (clientStack) => {
      clientStack.add(snsMiddleware.bind(null, shim), {
        name: 'NewRelicSnsMiddleware',
        step: 'initialize',
        priority: 'high'
      })
    }
  }
}

/**
 * Middleware hook that records the middleware chain
 * when command is `PublishCommand`
 *
 * @param {Shim} shim
 * @param {function} next middleware function
 * @param {Object} context
 * @returns {function}
 */
function snsMiddleware(shim, next, context) {
  if (context.commandName === 'PublishCommand') {
    return shim.recordProduce(next, getSnsSpec)
  }

  return next
}

/**
 * Returns the spec for PublishCommand
 *
 * @param {Shim} shim
 * @param {original} original original middleware function
 * @param {Array} args to the middleware function
 * @returns {Object}
 */
function getSnsSpec(shim, original, name, args) {
  const [command] = args
  return {
    promise: true,
    callback: shim.LAST,
    destinationName: getDestinationName(command.input),
    destinationType: shim.TOPIC,
    opaque: true
  }
}

/**
 * Helper to set the appropriate destinationName based on
 * the command input
 *
 * @param {Object}
 */
function getDestinationName({ TopicArn, TargetArn }) {
  return TopicArn || TargetArn || 'PhoneNumber' // We don't want the value of PhoneNumber
}