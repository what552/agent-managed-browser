#!/usr/bin/env node
import { Command } from 'commander'
import { startDaemon } from './commands/start'
import { stopDaemon } from './commands/stop'
import { showStatus } from './commands/status'
import { sessionCommands } from './commands/session'
import { actionCommands } from './commands/actions'
import { pagesCommands } from './commands/pages'
import { routeCommands } from './commands/route'
import { traceCommands } from './commands/trace'
import { browserLaunchCommand } from './commands/browser-launch'

const program = new Command()

program
  .name('agentmb')
  .description('agentmb — local Chromium runtime for AI agents')
  .version('0.1.1')

program
  .command('start')
  .description('Start the agentmb daemon')
  .option('-p, --port <port>', 'Port to listen on', '19315')
  .option('-d, --data-dir <dir>', 'Data directory', `${process.env.HOME}/.agentmb`)
  .option('-l, --log-level <level>', 'Log level (trace|debug|info|warn|error)', 'info')
  .action(startDaemon)

program
  .command('stop')
  .description('Stop the running agentmb daemon')
  .option('-d, --data-dir <dir>', 'Data directory', `${process.env.HOME}/.agentmb`)
  .action(stopDaemon)

program
  .command('status')
  .description('Show daemon status')
  .option('-p, --port <port>', 'Port', '19315')
  .action(showStatus)

sessionCommands(program)
actionCommands(program)
pagesCommands(program)
routeCommands(program)
traceCommands(program)
browserLaunchCommand(program)

program.parseAsync(process.argv).catch((err) => {
  console.error('Error:', err.message)
  process.exit(1)
})
